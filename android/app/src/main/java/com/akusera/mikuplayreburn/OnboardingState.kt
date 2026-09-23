package com.akusera.mikuplayreburn

import android.content.Context
import android.content.pm.PackageManager

object OnboardingState {
    private const val PREFS_NAME = "mikuplay_prefs"
    private const val KEY_COMPLETED = "onboarding_completed"
    private const val KEY_COMPLETED_VERSION = "onboarding_completed_version"

    private fun getCurrentVersion(context: Context): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
        } catch (e: PackageManager.NameNotFoundException) {
            "unknown"
        }
    }

    fun isCompleted(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_COMPLETED, false)) return false
        val savedVersion = prefs.getString(KEY_COMPLETED_VERSION, null) ?: return false
        return savedVersion == getCurrentVersion(context)
    }

    fun markCompleted(context: Context) {
        val versionName = getCurrentVersion(context)
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(KEY_COMPLETED, true)
            .putString(KEY_COMPLETED_VERSION, versionName)
            .apply()
    }

    fun reset(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .remove(KEY_COMPLETED)
            .remove(KEY_COMPLETED_VERSION)
            .apply()
    }
}