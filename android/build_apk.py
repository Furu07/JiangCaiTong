"""Build a locally signed Debug APK with Android SDK command-line tools."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile

ANDROID = Path(__file__).resolve().parent
ROOT = ANDROID.parent
VERSION = "0.9.1"
VERSION_CODE = 36
MIN_SDK = 26
TARGET_SDK = 33
BUILD_TOOLS = "35.0.0"


def sdk_root():
    configured = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if configured:
        return Path(configured)
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "Android" / "Sdk"
    return Path.home() / ("Library/Android/sdk" if os.sys.platform == "darwin" else "Android/Sdk")


def executable(name, directory=None):
    filename = name + (".exe" if os.name == "nt" else "")
    candidate = directory / filename if directory else shutil.which(filename)
    if not candidate or not Path(candidate).is_file():
        raise SystemExit(f"找不到 {filename}，请检查 SDK、JAVA_HOME 或 PATH。")
    return Path(candidate)


def run(*args):
    print(f"  {Path(args[0]).name} {args[1]}", flush=True)
    subprocess.run([str(arg) for arg in args], check=True)


def debug_keystore(keytool):
    # A separate per-user key keeps rebuilds installable over earlier JCT Debug APKs.
    key = Path.home() / ".android" / "jiangcaitong-debug.keystore"
    if not key.exists():
        key.parent.mkdir(parents=True, exist_ok=True)
        run(keytool, "-genkeypair", "-keystore", key, "-storetype", "PKCS12",
            "-storepass", "android", "-alias", "jctdebug", "-keyalg", "RSA",
            "-keysize", "2048", "-validity", "10000", "-dname", "CN=JiangCaiTong Debug")
    return key


def main():
    sdk = sdk_root()
    tools = sdk / "build-tools" / BUILD_TOOLS
    api = sdk / "platforms" / f"android-{TARGET_SDK}" / "android.jar"
    d8 = tools / "lib" / "d8.jar"
    signer = tools / "lib" / "apksigner.jar"
    for file in (api, d8, signer):
        if not file.is_file():
            raise SystemExit(f"找不到 {file}，请安装 Android 平台 {TARGET_SDK} 和 Build Tools {BUILD_TOOLS}。")
    java_home = os.environ.get("JAVA_HOME")
    jdk_bin = Path(java_home) / "bin" if java_home else None
    java = executable("java", jdk_bin)
    javac = executable("javac", jdk_bin)
    keytool = executable("keytool", jdk_bin)
    aapt = executable("aapt2", tools)
    align = executable("zipalign", tools)

    app = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
    if not re.search(r"^const APP_VERSION = '" + re.escape(VERSION) + r"';$", app, re.M):
        raise SystemExit("web/app.js 的版本与 Android 构建配置不一致。")
    # Use the supplied, authorized APK. Keep its client configuration out of Git.
    reference = ROOT / "base.apk"
    if not reference.is_file():
        reference = Path.home() / "Downloads" / "base.apk"
    water_values = {}
    if reference.is_file():
        expected = "e852a97f9eda9e3600626ec984b9633c5cdd97a8ad9341c372e589b69f50fa32"
        if hashlib.sha256(reference.read_bytes()).hexdigest() != expected:
            raise SystemExit("base.apk 与已核实的航院通 0.52.0 参考包哈希不一致。")
        with zipfile.ZipFile(reference) as archive:
            water_source = archive.read("assets/web/native.js").decode("utf-8")
        for field in ("SALT_APP", "SALT_MINI", "CID"):
            match = re.search(r"""^\s*""" + field + r""":\s*(['"])([^'"\r\n]+)\1\s*,""",
                              water_source, re.M)
            if not match:
                raise SystemExit("航院通 0.52.0 参考包缺少 798 配置字段。")
            water_values[field] = match.group(2)

    # Keep SDK/JDK temporary paths ASCII on Windows where aapt2 may reject Unicode paths.
    with tempfile.TemporaryDirectory(prefix="jct-apk-") as temp:
        build = Path(temp)
        assets = build / "assets"
        shutil.copytree(ROOT / "web", assets / "web")
        shutil.copyfile(ROOT / "LICENSE", assets / "LICENSE")
        shutil.copytree(ANDROID / "res", build / "res")
        shutil.copyfile(ANDROID / "AndroidManifest.xml", build / "AndroidManifest.xml")
        generated = build / "generated"
        classes = build / "classes"
        generated.mkdir()
        classes.mkdir()
        water_asset = assets / "web" / "water.js"
        source = water_asset.read_text(encoding="utf-8")
        for field in ("SALT_APP", "SALT_MINI", "CID"):
            marker = f'/* P7F:{field} */ ""'
            if source.count(marker) != 1:
                raise SystemExit("798 本地构建标记缺失或重复。")
            source = source.replace(marker, json.dumps(water_values.get(field, "")))
        water_asset.write_text(source, encoding="utf-8")

        compiled = build / "resources.zip"
        raw = build / "resources.apk"
        run(aapt, "compile", "--dir", build / "res", "-o", compiled)
        run(aapt, "link", "-I", api, "--manifest", build / "AndroidManifest.xml",
            "--min-sdk-version", MIN_SDK, "--target-sdk-version", TARGET_SDK,
            "--version-name", VERSION, "--version-code", VERSION_CODE, "--debug-mode",
            "-A", assets, "--java", generated, "-o", raw, compiled)
        run(javac, "--release", "8", "-Xlint:-options", "-g", "-encoding", "UTF-8", "-cp", api, "-d", classes,
            *sorted((ANDROID / "src").rglob("*.java")), *sorted(generated.rglob("*.java")))
        run(java, "-cp", d8, "com.android.tools.r8.D8", "--min-api", MIN_SDK,
            "--lib", api, "--output", build, *sorted(classes.rglob("*.class")))

        unaligned = build / "unaligned.apk"
        with zipfile.ZipFile(raw) as resources, zipfile.ZipFile(unaligned, "w") as apk:
            # Preserve each compression method, including stored resources.arsc.
            for entry in resources.infolist():
                apk.writestr(entry.filename, resources.read(entry), compress_type=entry.compress_type)
            apk.write(build / "classes.dex", "classes.dex", compress_type=zipfile.ZIP_DEFLATED)

        aligned = build / "aligned.apk"
        signed = build / "signed.apk"
        run(align, "-f", "4", unaligned, aligned)
        run(java, "-jar", signer, "sign", "--ks", debug_keystore(keytool),
            "--ks-key-alias", "jctdebug", "--ks-pass", "pass:android", "--key-pass", "pass:android",
            "--v4-signing-enabled", "false", "--out", signed, aligned)
        run(java, "-jar", signer, "verify", signed)

        dist = ANDROID / "dist"
        dist.mkdir(exist_ok=True)
        output = dist / f"JiangCaiTong-{VERSION}-debug.apk"
        with tempfile.NamedTemporaryFile(dir=dist, suffix=".apk.tmp", delete=False) as handle:
            staged = Path(handle.name)
        try:
            shutil.copyfile(signed, staged)
            staged.replace(output)
        finally:
            staged.unlink(missing_ok=True)
        print(f"\n{output}")


if __name__ == "__main__":
    main()
