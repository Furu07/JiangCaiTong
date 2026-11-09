package com.jxufe.jct;

import android.app.Application;
import android.content.Context;

/** 只为给 CredStore 一个稳定的 Context —— 存凭据的代码不该依赖 Activity 生命周期。 */
public class App extends Application {

    private static Context ctx;

    @Override
    public void onCreate() {
        super.onCreate();
        ctx = getApplicationContext();
        if (android.os.Build.VERSION.SDK_INT >= 28 && getProcessName().endsWith(":academic")) {
            android.webkit.WebView.setDataDirectorySuffix("jufe");
        } else {
            CxNet.restore();
        }
    }

    public static Context ctx() {
        return ctx;
    }
}
