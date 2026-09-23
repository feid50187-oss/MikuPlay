package com.akusera.mikuplayreburn.crash;

import android.content.Context;

import com.google.auto.service.AutoService;

import org.acra.config.CoreConfiguration;
import org.acra.sender.ReportSender;
import org.acra.sender.ReportSenderFactory;

/**
 * ACRA ReportSender 工厂 — 注册 CrashReportSender。
 * @AutoService 自动生成 META-INF/services 文件，ACRA 通过 ServiceLoader 发现。
 */
@AutoService(ReportSenderFactory.class)
public class CrashReportSenderFactory implements ReportSenderFactory {

    @Override
    public ReportSender create(Context context, CoreConfiguration config) {
        return new CrashReportSender();
    }
}
