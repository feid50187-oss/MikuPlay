
package com.akusera.mikuplayreburn;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Fullscreen")
public class FullscreenPlugin extends Plugin {

    @PluginMethod
    // 设置沉浸式模式（隐藏状态栏和导航栏）
    public void setImmersiveMode(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", true);

        getActivity().runOnUiThread(() -> {
            MainActivity activity = (MainActivity) getActivity();
            if (activity != null) {
                activity.setImmersiveMode(enabled != null && enabled);
                call.resolve();
            } else {
                call.reject("Activity 不可用");
            }
        });
    }

    @PluginMethod
    // 获取当前是否处于沉浸式模式
    public void isImmersiveMode(PluginCall call) {
        MainActivity activity = (MainActivity) getActivity();
        if (activity != null) {
            call.resolve(new JSObject().put("enabled", activity.isImmersiveMode()));
        } else {
            call.reject("Activity 不可用");
        }
    }

    @PluginMethod
    // 主动呼出安全区调整窗口（用于用户需要重新校准时）
    public void showSafeAreaTuner(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            MainActivity activity = (MainActivity) getActivity();
            if (activity != null) {
                activity.showSafeAreaTunerManually();
                call.resolve();
            } else {
                call.reject("Activity 不可用");
            }
        });
    }
}
