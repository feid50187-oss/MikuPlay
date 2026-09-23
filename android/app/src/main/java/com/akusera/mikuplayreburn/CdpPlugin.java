package com.akusera.mikuplayreburn;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Cdp")
public class CdpPlugin extends Plugin {
    private static final String TAG = "CdpPlugin";
    private long handle = 0;
    private String lastEndpoint = "";
    private int nextId = 1;

    static {
        System.loadLibrary("mikuplay_encoder");
    }

    private native long nativeCreate();
    private native void nativeDestroy(long h);
    private native String nativeStart(long h, int port, String override);
    private native void nativeStop(long h);
    private native String nativeSendCommand(long h, int id, String method, String paramsJson);

    @Override
    public void load() {
        super.load();
        handle = nativeCreate();
        Log.d(TAG, "CdpPlugin 已加载，handle: " + handle);
    }

    @PluginMethod
    public void start(PluginCall call) {
        Integer port = call.getInt("port", 9222);
        String override = call.getString("abstractSocketOverride", "");

        try {
            String json = nativeStart(handle, port, override);
            JSObject info = new JSObject(json);

            if (info.optBoolean("success", false)) {
                lastEndpoint = info.optString("endpoint", "");
            }

            JSObject ret = new JSObject();
            ret.put("raw", json);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "CDP 启动失败", e);
            call.reject("CDP start failed", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            if (handle != 0) {
                nativeStop(handle);
            }
            lastEndpoint = "";
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "CDP 停止失败", e);
            call.reject("CDP stop failed", e);
        }
    }

    @PluginMethod
    public void getCdpUrl(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("url", lastEndpoint);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("getCdpUrl failed", e);
        }
    }

    @PluginMethod
    public void sendCommand(PluginCall call) {
        String method = call.getString("method", "");
        String paramsJson = call.getString("params", "{}");

        if (method.isEmpty()) {
            call.reject("method is required");
            return;
        }

        if (handle == 0) {
            call.reject("CdpProxy not initialized");
            return;
        }

        try {
            int id = nextId++;
            String resultJson = nativeSendCommand(handle, id, method, paramsJson);
            JSObject result = new JSObject(resultJson);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "sendCommand 失败", e);
            call.reject("sendCommand failed", e);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (handle != 0) {
            nativeStop(handle);
            nativeDestroy(handle);
            handle = 0;
        }
        super.handleOnDestroy();
    }
}
