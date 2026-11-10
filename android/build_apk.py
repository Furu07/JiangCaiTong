"""Build a locally signed Debug APK with Android SDK command-line tools."""
from pathlib import Path
import base64
import os
import re
import shutil
import subprocess
import tempfile
import zipfile

ANDROID = Path(__file__).resolve().parent
ROOT = ANDROID.parent
VERSION = "0.6.4"
VERSION_CODE = 21
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
    salt = os.environ.get("JCT_WATER_APP_SIGN_SALT", "")
    if salt and (salt != salt.strip() or not salt.isprintable() or len(salt.encode("utf-8")) > 256
                 or salt.lower() in {"your_app_sign_salt_here", "your_salt_here", "test-salt"}
                 or re.fullmatch(r"(?:[A-Z][a-z]){13}\d+", salt)):
        raise SystemExit("JCT_WATER_APP_SIGN_SALT 格式无效或为示例值。")

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
        package = generated / "com" / "jxufe" / "jct"
        package.mkdir(parents=True)
        encoded = base64.b64encode(salt.encode("utf-8")).decode("ascii")
        (package / "WaterLoginConfig.java").write_text(
            'package com.jxufe.jct;\nfinal class WaterLoginConfig {\n'
            f'    static final String SALT_BASE64 = "{encoded}";\n' '}\n', encoding="ascii")

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
