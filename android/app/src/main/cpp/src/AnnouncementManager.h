#ifndef MIKUPLAY_ANNOUNCEMENT_MANAGER_H
#define MIKUPLAY_ANNOUNCEMENT_MANAGER_H

#include <jni.h>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

// ============================================================================
// 公告系统（C++ Native 层）
//
// 组成：
//   - MkaParser         解析 .mka 文件（META / CONTROLS / CONTENT 三段）
//   - LocalProvider     扫描本地 .mka 文件（内部存储优先，其次 assets）
//   - DisplayPolicy     基于 SharedPreferences 的"不再显示"策略
//   - RemoteProvider    Git Raw 同步：libcurl HTTP + state.json 解析 +
//                       SHA-256 校验 + 缓存原子替换 + BJT 00:00 调度
//   - AnnouncementManager  编排上述模块，输出 JSON 供 Kotlin 侧渲染
//
// 在线同步采用多公告架构：远程仓库包含 state.json 与多个 .mka 文件（文件名不固定）。
// 同步时优先比较本地与远程 state.json 的 SHA-256，若一致则跳过下载。
// 旧版 index.json + OnlineAnnouncement.mka 已废弃，新版本不再加载。
// ============================================================================

// 单条公告的结构化数据（解析后）
struct AnnouncementData {
    std::string id;
    std::string version;
    std::string date;
    int priority = 0;
    std::string title;
    std::vector<std::string> controls;  // 如 "dont_show_again"、"action_url:..."
    std::string content;                 // CONTENT 段原文（简化 Markdown）
    int hiddenAt = 0;                    // 更新公告标记（versionCode 门槛）。
                                         // 0=未设置（表无标记，仅更新公告携带）；设置后，
                                         // 当前版本 versionCode < hiddenAt 才显示。
};

// state.json 中的单条公告文件清单条目
struct StateEntry {
    std::string filename;  // 文件名（含 .mka 扩展名）
    std::string sha256;    // 文件内容 SHA-256（十六进制小写）
};

// 解析 .mka 文件内容。格式无效时返回 std::nullopt。
std::optional<AnnouncementData> mkaParse(const std::string& mkaContent);

// 加载所有可显示的公告（已按 priority 降序排列），以 JSON 数组字符串返回。
// 内部完成：扫描文件 → 解析 → 过滤已 dismissed → 排序。
// 失败时返回空字符串（Kotlin 侧视为无可显示公告）。
std::string loadVisibleAnnouncementsJson(JNIEnv* env, jobject context);

// 标记某公告为"不再显示"，写入 SharedPreferences。
void markAnnouncementDismissed(JNIEnv* env, jobject context, const std::string& announcementId);

// ============================================================================
// RemoteProvider — 在线公告同步（Git Raw）
// ============================================================================

// 检查并执行远程同步（BJT 00:00 界限，全程在 C++ 中完成）。
// 返回值：true=已同步或跳过（可继续显示公告），false=同步异常（仍可显示缓存）。
bool syncRemoteAnnouncements(JNIEnv* env, jobject context);

#endif // MIKUPLAY_ANNOUNCEMENT_MANAGER_H
