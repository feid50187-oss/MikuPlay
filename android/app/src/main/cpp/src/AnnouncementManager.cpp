#include "AnnouncementManager.h"

#include <android/log.h>
#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>

#include <curl/curl.h>
#include <picosha256.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <dirent.h>
#include <fstream>
#include <set>
#include <sstream>
#include <sys/stat.h>
#include <unistd.h>

#define TAG "AnnouncementMgr"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// ============================================================================
// 字符串工具
// ============================================================================

namespace {

// 去除首尾空白（含 \r\n\t 及全角空格）
std::string trim(const std::string& s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

// 按行分割（保留空行，用于 CONTENT 段）
std::vector<std::string> splitLines(const std::string& s) {
    std::vector<std::string> lines;
    std::string current;
    for (size_t i = 0; i < s.size(); ++i) {
        char c = s[i];
        if (c == '\n') {
            // 去除行尾 \r（Windows 换行兼容）
            if (!current.empty() && current.back() == '\r') {
                current.pop_back();
            }
            lines.push_back(current);
            current.clear();
        } else {
            current += c;
        }
    }
    // 最后一行（无换行结尾）
    if (!current.empty()) {
        if (!current.empty() && current.back() == '\r') {
            current.pop_back();
        }
        lines.push_back(current);
    }
    return lines;
}

// JSON 字符串转义：处理 " \ \n \r \t 及控制字符
std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (size_t i = 0; i < s.size(); ++i) {
        unsigned char c = static_cast<unsigned char>(s[i]);
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            case '\b': out += "\\b";  break;
            case '\f': out += "\\f";  break;
            default:
                if (c < 0x20) {
                    // 控制字符 → \uXXXX
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);
                }
                break;
        }
    }
    return out;
}

// ============================================================================
// MkaParser — 解析 .mka 文件
// ============================================================================

// 段落标记
constexpr const char* META_MARKER     = "---META---";
constexpr const char* CONTROLS_MARKER = "---CONTROLS---";
constexpr const char* CONTENT_MARKER  = "---CONTENT---";

// 在文本中查找段落标记的位置（必须位于行首）
// 返回标记之后内容起始位置（跳过标记行尾的换行），pos 为标记行起始位置
size_t findSectionMarker(const std::string& text, const char* marker, size_t from) {
    size_t markerLen = std::strlen(marker);
    size_t pos = from;
    while (pos < text.size()) {
        // 检查是否在行首
        bool atLineStart = (pos == 0) || (text[pos - 1] == '\n');
        if (atLineStart && text.compare(pos, markerLen, marker) == 0) {
            return pos;
        }
        // 前进到下一行
        size_t next = text.find('\n', pos);
        if (next == std::string::npos) break;
        pos = next + 1;
    }
    return std::string::npos;
}

// 提取标记行之后到下一个标记（或文本末尾）之间的内容
// startPos 指向标记行起始，返回标记行之后的内容（不含标记行本身）
std::string extractSection(const std::string& text, size_t markerStart, size_t nextMarkerStart) {
    // 跳过标记行本身（找到标记行后的第一个换行）
    size_t markerEnd = text.find('\n', markerStart);
    if (markerEnd == std::string::npos) return "";

    size_t contentStart = markerEnd + 1;
    size_t contentEnd;
    if (nextMarkerStart == std::string::npos) {
        contentEnd = text.size();
    } else {
        contentEnd = nextMarkerStart;
    }

    if (contentStart > contentEnd) return "";
    return text.substr(contentStart, contentEnd - contentStart);
}

bool parseMeta(const std::string& meta, AnnouncementData& out) {
    auto lines = splitLines(meta);
    for (const auto& line : lines) {
        std::string trimmed = trim(line);
        if (trimmed.empty()) continue;

        size_t colon = trimmed.find(':');
        if (colon == std::string::npos) continue;

        std::string key = trim(trimmed.substr(0, colon));
        std::string value = trim(trimmed.substr(colon + 1));

        if (key == "id") {
            out.id = value;
        } else if (key == "version") {
            out.version = value;
        } else if (key == "date") {
            out.date = value;
        } else if (key == "priority") {
            try {
                out.priority = std::stoi(value);
            } catch (...) {
                out.priority = 0;
            }
        } else if (key == "title") {
            out.title = value;
        } else if (key == "hidden_at") {
            // 更新公告标记：versionCode 门槛。解析失败/非正数视为未设置（0）
            try {
                int v = std::stoi(value);
                out.hiddenAt = (v > 0) ? v : 0;
            } catch (...) {
                out.hiddenAt = 0;
            }
        }
    }

    // id 为必填项
    if (out.id.empty()) {
        return false;
    }

    // title 未提供时自动生成
    if (out.title.empty()) {
        if (!out.version.empty()) {
            out.title = "MikuPlay Reburn " + out.version + " 更新日志";
        } else {
            out.title = "MikuPlay Reburn 公告";
        }
    }

    return true;
}

void parseControls(const std::string& controls, AnnouncementData& out) {
    auto lines = splitLines(controls);
    for (const auto& line : lines) {
        std::string trimmed = trim(line);
        if (trimmed.empty()) continue;
        out.controls.push_back(trimmed);
    }

    // action_close 始终存在（默认），未显式声明时补充
    bool hasClose = false;
    for (const auto& c : out.controls) {
        if (c == "action_close") {
            hasClose = true;
            break;
        }
    }
    if (!hasClose) {
        out.controls.push_back("action_close");
    }
}

} // namespace

std::optional<AnnouncementData> mkaParse(const std::string& mkaContent) {
    if (mkaContent.empty()) {
        return std::nullopt;
    }

    // 定位三个段落标记
    size_t metaPos = findSectionMarker(mkaContent, META_MARKER, 0);
    if (metaPos == std::string::npos) {
        LOGW("MKA 解析失败：缺少 ---META--- 段");
        return std::nullopt;
    }

    size_t controlsPos = findSectionMarker(mkaContent, CONTROLS_MARKER, metaPos + 1);
    if (controlsPos == std::string::npos) {
        LOGW("MKA 解析失败：缺少 ---CONTROLS--- 段");
        return std::nullopt;
    }

    size_t contentPos = findSectionMarker(mkaContent, CONTENT_MARKER, controlsPos + 1);
    if (contentPos == std::string::npos) {
        LOGW("MKA 解析失败：缺少 ---CONTENT--- 段");
        return std::nullopt;
    }

    // 提取各段内容
    std::string metaStr     = extractSection(mkaContent, metaPos, controlsPos);
    std::string controlsStr = extractSection(mkaContent, controlsPos, contentPos);
    std::string contentStr  = extractSection(mkaContent, contentPos, std::string::npos);

    AnnouncementData data;

    if (!parseMeta(metaStr, data)) {
        LOGW("MKA 解析失败：META 段缺少必填字段 id");
        return std::nullopt;
    }

    parseControls(controlsStr, data);

    // CONTENT 段：去除首尾空行，保留内部结构
    data.content = trim(contentStr);

    LOGD("MKA 解析成功：id=%s priority=%d", data.id.c_str(), data.priority);
    return data;
}

// ============================================================================
// LocalProvider — 扫描本地 .mka 文件
// ============================================================================

namespace {

// assets 中公告目录的相对路径（AAssetManager 路径，不含前导 /）
constexpr const char* ASSETS_ANNOUNCEMENTS_DIR = "public/announcements";

// 内部存储中公告目录名（相对于 getFilesDir()）
constexpr const char* INTERNAL_ANNOUNCEMENTS_DIR = "announcements";

// 文件扩展名
constexpr const char* MKA_EXTENSION = ".mka";

// 从 AAssetManager 扫描公告目录，返回 .mka 文件原始内容列表
std::vector<std::string> scanAssets(JNIEnv* env, jobject context) {
    std::vector<std::string> results;

    // context.getAssets()
    jclass ctxClass = env->GetObjectClass(context);
    jmethodID getAssets = env->GetMethodID(ctxClass, "getAssets",
                                            "()Landroid/content/res/AssetManager;");
    if (!getAssets) {
        LOGE("无法找到 getAssets 方法");
        env->DeleteLocalRef(ctxClass);
        return results;
    }
    jobject assetManagerObj = env->CallObjectMethod(context, getAssets);
    env->DeleteLocalRef(ctxClass);
    if (!assetManagerObj) {
        LOGW("getAssets() 返回 null");
        return results;
    }

    AAssetManager* mgr = AAssetManager_fromJava(env, assetManagerObj);
    if (!mgr) {
        LOGE("AAssetManager_fromJava 失败");
        env->DeleteLocalRef(assetManagerObj);
        return results;
    }

    AAssetDir* dir = AAssetManager_openDir(mgr, ASSETS_ANNOUNCEMENTS_DIR);
    if (!dir) {
        LOGW("无法打开 assets 目录: %s", ASSETS_ANNOUNCEMENTS_DIR);
        env->DeleteLocalRef(assetManagerObj);
        return results;
    }

    const char* filename = AAssetDir_getNextFileName(dir);
    while (filename != nullptr) {
        std::string name(filename);
        // 仅处理 .mka 文件
        if (name.size() >= 4 &&
            name.compare(name.size() - 4, 4, MKA_EXTENSION) == 0) {
            // 构造完整路径
            std::string fullPath = std::string(ASSETS_ANNOUNCEMENTS_DIR) + "/" + name;
            AAsset* asset = AAssetManager_open(mgr, fullPath.c_str(), AASSET_MODE_BUFFER);
            if (asset) {
                off_t length = AAsset_getLength(asset);
                const char* buf = static_cast<const char*>(AAsset_getBuffer(asset));
                if (buf && length > 0) {
                    results.emplace_back(buf, static_cast<size_t>(length));
                    LOGD("从 assets 读取: %s (%ld bytes)", name.c_str(), (long)length);
                }
                AAsset_close(asset);
            }
        }
        filename = AAssetDir_getNextFileName(dir);
    }

    AAssetDir_close(dir);
    env->DeleteLocalRef(assetManagerObj);

    LOGI("从 assets 扫描到 %zu 个 .mka 文件", results.size());
    return results;
}

// 从内部存储扫描公告目录（getFilesDir()/announcements/）
std::vector<std::string> scanInternalStorage(JNIEnv* env, jobject context) {
    std::vector<std::string> results;

    // context.getFilesDir()
    jclass ctxClass = env->GetObjectClass(context);
    jmethodID getFilesDir = env->GetMethodID(ctxClass, "getFilesDir",
                                              "()Ljava/io/File;");
    if (!getFilesDir) {
        env->DeleteLocalRef(ctxClass);
        return results;
    }
    jobject filesDirObj = env->CallObjectMethod(context, getFilesDir);
    env->DeleteLocalRef(ctxClass);
    if (!filesDirObj) {
        return results;
    }

    // filesDir.getPath()
    jclass fileClass = env->GetObjectClass(filesDirObj);
    jmethodID getPath = env->GetMethodID(fileClass, "getPath", "()Ljava/lang/String;");
    std::string filesDirPath;
    if (getPath) {
        jstring pathStr = static_cast<jstring>(env->CallObjectMethod(filesDirObj, getPath));
        if (pathStr) {
            const char* chars = env->GetStringUTFChars(pathStr, nullptr);
            if (chars) {
                filesDirPath = chars;
                env->ReleaseStringUTFChars(pathStr, chars);
            }
            env->DeleteLocalRef(pathStr);
        }
    }
    env->DeleteLocalRef(fileClass);
    env->DeleteLocalRef(filesDirObj);

    if (filesDirPath.empty()) {
        return results;
    }

    std::string dirPath = filesDirPath + "/" + INTERNAL_ANNOUNCEMENTS_DIR;
    DIR* dir = opendir(dirPath.c_str());
    if (!dir) {
        // 目录不存在属正常情况（无热更新公告）
        return results;
    }

    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        std::string name(entry->d_name);
        if (name == "." || name == "..") continue;

        // 仅处理 .mka 文件
        if (name.size() >= 4 &&
            name.compare(name.size() - 4, 4, MKA_EXTENSION) == 0) {
            std::string fullPath = dirPath + "/" + name;
            std::ifstream file(fullPath, std::ios::binary);
            if (file.is_open()) {
                std::stringstream ss;
                ss << file.rdbuf();
                results.push_back(ss.str());
                LOGD("从内部存储读取: %s", name.c_str());
            }
        }
    }

    closedir(dir);
    LOGI("从内部存储扫描到 %zu 个 .mka 文件", results.size());
    return results;
}

} // namespace

// ============================================================================
// DisplayPolicy — "不再显示"策略（SharedPreferences）
// ============================================================================

namespace {

constexpr const char* PREFS_NAME = "mikuplay_prefs";
constexpr const char* KEY_DISMISSED = "announcement_dismissed";

// 读取已 dismissed 的公告 id 集合（JSON 数组格式存储）
std::set<std::string> getDismissedIds(JNIEnv* env, jobject context) {
    std::set<std::string> result;

    jclass ctxClass = env->GetObjectClass(context);
    jmethodID getSharedPreferences = env->GetMethodID(ctxClass,
        "getSharedPreferences", "(Ljava/lang/String;I)Landroid/content/SharedPreferences;");
    if (!getSharedPreferences) {
        env->DeleteLocalRef(ctxClass);
        return result;
    }

    jstring jPrefsName = env->NewStringUTF(PREFS_NAME);
    jobject prefs = env->CallObjectMethod(context, getSharedPreferences, jPrefsName, 0);
    env->DeleteLocalRef(jPrefsName);
    env->DeleteLocalRef(ctxClass);
    if (!prefs) return result;

    jclass prefsClass = env->GetObjectClass(prefs);
    jmethodID getString = env->GetMethodID(prefsClass, "getString",
        "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;");
    if (!getString) {
        env->DeleteLocalRef(prefsClass);
        env->DeleteLocalRef(prefs);
        return result;
    }

    jstring jKey = env->NewStringUTF(KEY_DISMISSED);
    jstring jDef = env->NewStringUTF("[]");
    jstring jValue = static_cast<jstring>(env->CallObjectMethod(prefs, getString, jKey, jDef));
    env->DeleteLocalRef(jKey);
    env->DeleteLocalRef(jDef);
    env->DeleteLocalRef(prefsClass);
    env->DeleteLocalRef(prefs);

    std::string jsonStr;
    if (jValue) {
        const char* chars = env->GetStringUTFChars(jValue, nullptr);
        if (chars) {
            jsonStr = chars;
            env->ReleaseStringUTFChars(jValue, chars);
        }
        env->DeleteLocalRef(jValue);
    }

    // 解析 JSON 数组（格式：["id1","id2","id3"]，不支持转义——公告 ID 不含引号/反斜杠）
    if (jsonStr.empty() || jsonStr == "[]") return result;

    for (size_t pos = 0; pos < jsonStr.size();) {
        pos = jsonStr.find('"', pos);
        if (pos == std::string::npos) break;
        pos++; // 跳过开头的 "
        size_t end = jsonStr.find('"', pos);
        if (end == std::string::npos) break;
        std::string id = jsonStr.substr(pos, end - pos);
        if (!id.empty()) {
            result.insert(std::move(id));
        }
        pos = end + 1; // 跳过结尾的 "
    }

    LOGD("已加载 %zu 个已 dismissed 的公告 ID", result.size());
    return result;
}

// 读取当前应用 versionCode，用于 hidden_at 门槛比较。
// PackageInfo.versionCode 在所有 API 上都是 int，直接读取即可；
// 若 GetFieldID 失败会挂起 NoSuchFieldError(Throwable)，必须先 ExceptionClear，
// 否则 pending 异常带回 Java 层会导致进程崩溃。失败返回 0。
int getCurrentVersionCode(JNIEnv* env, jobject context) {
    jclass ctxClass = env->GetObjectClass(context);
    if (!ctxClass) return 0;

    // context.getPackageManager()
    jmethodID getPm = env->GetMethodID(ctxClass, "getPackageManager",
        "()Landroid/content/pm/PackageManager;");
    if (!getPm) { env->DeleteLocalRef(ctxClass); return 0; }
    jobject pm = env->CallObjectMethod(context, getPm);
    if (!pm) { env->DeleteLocalRef(ctxClass); return 0; }

    // context.getPackageName()
    jmethodID getPkgName = env->GetMethodID(ctxClass, "getPackageName",
        "()Ljava/lang/String;");
    if (!getPkgName) {
        env->DeleteLocalRef(pm);
        env->DeleteLocalRef(ctxClass);
        return 0;
    }
    jstring pkgName = static_cast<jstring>(env->CallObjectMethod(context, getPkgName));
    if (!pkgName) {
        env->DeleteLocalRef(pm);
        env->DeleteLocalRef(ctxClass);
        return 0;
    }

    // pm.getPackageInfo(packageName, 0)
    jclass pmClass = env->GetObjectClass(pm);
    jmethodID getPkgInfo = env->GetMethodID(pmClass, "getPackageInfo",
        "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;");
    if (!getPkgInfo) {
        env->DeleteLocalRef(pkgName);
        env->DeleteLocalRef(pmClass);
        env->DeleteLocalRef(pm);
        env->DeleteLocalRef(ctxClass);
        return 0;
    }
    jobject pkgInfo = env->CallObjectMethod(pm, getPkgInfo, pkgName, 0);
    env->DeleteLocalRef(pkgName);
    env->DeleteLocalRef(pmClass);
    env->DeleteLocalRef(pm);
    env->DeleteLocalRef(ctxClass);

    // getPackageInfo 可能抛 NameNotFoundException
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        return 0;
    }
    if (!pkgInfo) return 0;

    jclass piClass = env->GetObjectClass(pkgInfo);
    int versionCode = 0;
    jfieldID versionCodeField = env->GetFieldID(piClass, "versionCode", "I");
    if (env->ExceptionCheck()) {
        // 读不到则清理异常，返回 0（视为未启用门槛）
        env->ExceptionClear();
        versionCodeField = nullptr;
    }
    if (versionCodeField) {
        versionCode = static_cast<int>(env->GetIntField(pkgInfo, versionCodeField));
    }

    env->DeleteLocalRef(piClass);
    env->DeleteLocalRef(pkgInfo);
    LOGD("当前应用 versionCode: %d", versionCode);
    return versionCode;
}

} // namespace

// ============================================================================
// RemoteProvider — 在线公告同步（Git Raw）
//
// 全程在 C++ 中完成：libcurl HTTP + JSON 解析 + SHA-256 校验 + 缓存原子替换
// 简化架构：远程仓库仅含 index.json 与 OnlineAnnouncement.mka
// 同步优先比较本地与远程 index.json 的 SHA-256，一致则跳过下载
// ============================================================================

namespace {

// ── 常量 ──

// Git Raw Base URL（P4 阶段将改为加密字节数组，运行时解密）
// GitCode 格式：https://gitcode.com/{owner}/{repo}/raw/{branch}/
// 注意：用 /raw/ 而非 /blob/（blob 返回 HTML 页面，raw 返回文件原始内容）
// TODO(P4): 替换为 XOR 加密字节数组，运行时解密，不暴露给 Java/JS 层
constexpr const char* REMOTE_BASE_URL =
    "https://api.gitcode.com/api/v5/repos/akusera1/mikuplayannouncement/raw/";

// 远程索引文件名
constexpr const char* STATE_JSON_FILENAME = "state.json";

// 临时目录名（相对于 getFilesDir()）
constexpr const char* TEMP_ANNOUNCEMENTS_DIR = "announcements.tmp";

// 响应体大小限制（1MB）
constexpr size_t MAX_FILE_SIZE = 1048576;

// SharedPreferences 同步时间戳键
constexpr const char* KEY_LAST_SYNC = "announcement_last_sync";

// ── libcurl 全局初始化（线程安全的懒初始化）──

struct CurlGlobalInit {
    CurlGlobalInit()  { curl_global_init(CURL_GLOBAL_DEFAULT); }
    ~CurlGlobalInit() { curl_global_cleanup(); }
};

void ensureCurlInit() {
    static CurlGlobalInit init;
}

// ── libcurl 写回调 ──

size_t curlWriteCallback(char* ptr, size_t size, size_t nmemb, void* userdata) {
    size_t totalBytes = size * nmemb;
    auto* response = static_cast<std::string*>(userdata);
    if (response->size() + totalBytes > MAX_FILE_SIZE) {
        LOGW("响应体超过 %zu 字节限制，中止下载", MAX_FILE_SIZE);
        return 0;  // 返回 0 触发 CURLE_WRITE_ERROR
    }
    response->append(ptr, totalBytes);
    return totalBytes;
}

// ── HTTP GET（libcurl）──
// caCertPath: CA 证书包路径（用于 HTTPS 证书验证），空则跳过
// 返回：成功 → (true, data)；失败 → (false, "")

std::pair<bool, std::string> httpGet(const std::string& url,
                                       const std::string& caCertPath = "") {
    ensureCurlInit();

    CURL* curl = curl_easy_init();
    if (!curl) {
        LOGE("curl_easy_init 失败");
        return {false, ""};
    }

    std::string response;
    long responseCode = 0;

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 5L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curlWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    // 设置 CA 证书包（mbedTLS 不内置 CA 包，必须外部提供）
    if (!caCertPath.empty()) {
        curl_easy_setopt(curl, CURLOPT_CAINFO, caCertPath.c_str());
    }

    CURLcode res = curl_easy_perform(curl);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &responseCode);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        LOGW("HTTP 请求失败: curl=%d code=%ld", res, responseCode);
        return {false, ""};
    }
    if (responseCode < 200 || responseCode >= 300) {
        LOGW("HTTP 状态错误: code=%ld", responseCode);
        return {false, ""};
    }

    return {true, response};
}

// ── SHA-256（picosha256）──

std::string sha256Hex(const std::string& data) {
    return picosha2::hash256_hex_string(data);
}

// ── 最小 JSON 解析器（用于 index.json）──

struct JsonValue {
    enum Type { Null, Bool, Number, String, Array, Object };
    Type type = Null;
    bool boolVal = false;
    double numVal = 0;
    std::string strVal;
    std::vector<JsonValue> arrVal;
    std::vector<std::pair<std::string, JsonValue>> objVal;

    const JsonValue* find(const std::string& key) const {
        if (type != Object) return nullptr;
        for (const auto& kv : objVal) {
            if (kv.first == key) return &kv.second;
        }
        return nullptr;
    }
};

class JsonParser {
public:
    explicit JsonParser(const std::string& s) : s_(s), i_(0) {}

    JsonValue parse() {
        skipWs();
        return parseValue();
    }

private:
    const std::string& s_;
    size_t i_;

    void skipWs() {
        while (i_ < s_.size() &&
               (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r')) {
            i_++;
        }
    }

    JsonValue parseValue() {
        skipWs();
        if (i_ >= s_.size()) return {};
        char c = s_[i_];
        if (c == '"') return parseString();
        if (c == '{')  return parseObject();
        if (c == '[')  return parseArray();
        if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
        return parseKeyword();
    }

    JsonValue parseString() {
        JsonValue v;
        v.type = JsonValue::String;
        i_++;  // 跳过开头 "
        while (i_ < s_.size() && s_[i_] != '"') {
            if (s_[i_] == '\\' && i_ + 1 < s_.size()) {
                char e = s_[i_ + 1];
                switch (e) {
                    case '"':  v.strVal += '"';  break;
                    case '\\': v.strVal += '\\'; break;
                    case '/':  v.strVal += '/';  break;
                    case 'n':  v.strVal += '\n'; break;
                    case 'r':  v.strVal += '\r'; break;
                    case 't':  v.strVal += '\t'; break;
                    case 'b':  v.strVal += '\b'; break;
                    case 'f':  v.strVal += '\f'; break;
                    case 'u': {
                        if (i_ + 5 < s_.size()) {
                            unsigned int cp = 0;
                            for (int j = 0; j < 4; j++) {
                                cp <<= 4;
                                char h = s_[i_ + 2 + j];
                                if (h >= '0' && h <= '9') cp |= h - '0';
                                else if (h >= 'a' && h <= 'f') cp |= h - 'a' + 10;
                                else if (h >= 'A' && h <= 'F') cp |= h - 'A' + 10;
                            }
                            if (cp < 0x80) {
                                v.strVal += static_cast<char>(cp);
                            } else if (cp < 0x800) {
                                v.strVal += static_cast<char>(0xC0 | (cp >> 6));
                                v.strVal += static_cast<char>(0x80 | (cp & 0x3F));
                            } else {
                                v.strVal += static_cast<char>(0xE0 | (cp >> 12));
                                v.strVal += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
                                v.strVal += static_cast<char>(0x80 | (cp & 0x3F));
                            }
                            i_ += 4;
                        }
                        break;
                    }
                    default: v.strVal += e; break;
                }
                i_ += 2;
            } else {
                v.strVal += s_[i_];
                i_++;
            }
        }
        if (i_ < s_.size()) i_++;  // 跳过结尾 "
        return v;
    }

    JsonValue parseNumber() {
        JsonValue v;
        v.type = JsonValue::Number;
        size_t start = i_;
        if (i_ < s_.size() && s_[i_] == '-') i_++;
        while (i_ < s_.size() &&
               ((s_[i_] >= '0' && s_[i_] <= '9') || s_[i_] == '.' ||
                s_[i_] == 'e' || s_[i_] == 'E' ||
                s_[i_] == '+' || s_[i_] == '-')) {
            i_++;
        }
        try {
            v.numVal = std::stod(s_.substr(start, i_ - start));
        } catch (...) {
            v.numVal = 0;
        }
        return v;
    }

    JsonValue parseObject() {
        JsonValue v;
        v.type = JsonValue::Object;
        i_++;  // 跳过 {
        skipWs();
        if (i_ < s_.size() && s_[i_] == '}') { i_++; return v; }
        while (i_ < s_.size()) {
            skipWs();
            if (i_ >= s_.size() || s_[i_] != '"') break;
            JsonValue key = parseString();
            skipWs();
            if (i_ >= s_.size() || s_[i_] != ':') break;
            i_++;  // 跳过 :
            JsonValue val = parseValue();
            v.objVal.emplace_back(key.strVal, std::move(val));
            skipWs();
            if (i_ < s_.size() && s_[i_] == ',') { i_++; continue; }
            if (i_ < s_.size() && s_[i_] == '}') { i_++; break; }
            break;
        }
        return v;
    }

    JsonValue parseArray() {
        JsonValue v;
        v.type = JsonValue::Array;
        i_++;  // 跳过 [
        skipWs();
        if (i_ < s_.size() && s_[i_] == ']') { i_++; return v; }
        while (i_ < s_.size()) {
            JsonValue val = parseValue();
            v.arrVal.push_back(std::move(val));
            skipWs();
            if (i_ < s_.size() && s_[i_] == ',') { i_++; continue; }
            if (i_ < s_.size() && s_[i_] == ']') { i_++; break; }
            break;
        }
        return v;
    }

    JsonValue parseKeyword() {
        JsonValue v;
        if (i_ + 4 <= s_.size() && s_.compare(i_, 4, "true") == 0) {
            v.type = JsonValue::Bool; v.boolVal = true; i_ += 4;
        } else if (i_ + 5 <= s_.size() && s_.compare(i_, 5, "false") == 0) {
            v.type = JsonValue::Bool; v.boolVal = false; i_ += 5;
        } else if (i_ + 4 <= s_.size() && s_.compare(i_, 4, "null") == 0) {
            v.type = JsonValue::Null; i_ += 4;
        }
        return v;
    }
};

// ── state.json 解析 ──

std::vector<StateEntry> parseStateJson(const std::string& json) {
    std::vector<StateEntry> entries;
    if (json.empty()) return entries;

    JsonParser parser(json);
    JsonValue root = parser.parse();

    if (root.type != JsonValue::Object) {
        LOGW("state.json 根元素不是对象");
        return entries;
    }

    const JsonValue* announcements = root.find("announcements");
    if (!announcements || announcements->type != JsonValue::Array) {
        LOGW("state.json 缺少 announcements 数组");
        return entries;
    }

    for (const auto& item : announcements->arrVal) {
        if (item.type != JsonValue::Object) continue;
        const JsonValue* name = item.find("name");
        const JsonValue* sha  = item.find("sha256");
        if (!name || name->type != JsonValue::String) continue;
        if (!sha || sha->type != JsonValue::String) continue;

        StateEntry entry;
        entry.filename = name->strVal;
        entry.sha256   = sha->strVal;
        entries.push_back(std::move(entry));
    }

    return entries;
}

// ── 文件 I/O 辅助 ──

std::string getFilesDirPath(JNIEnv* env, jobject context) {
    jclass ctxClass = env->GetObjectClass(context);
    jmethodID getFilesDir = env->GetMethodID(ctxClass, "getFilesDir",
                                              "()Ljava/io/File;");
    env->DeleteLocalRef(ctxClass);
    if (!getFilesDir) return "";

    jobject filesDirObj = env->CallObjectMethod(context, getFilesDir);
    if (!filesDirObj) return "";

    jclass fileClass = env->GetObjectClass(filesDirObj);
    jmethodID getPath = env->GetMethodID(fileClass, "getPath", "()Ljava/lang/String;");
    std::string path;
    if (getPath) {
        jstring pathStr = static_cast<jstring>(env->CallObjectMethod(filesDirObj, getPath));
        if (pathStr) {
            const char* chars = env->GetStringUTFChars(pathStr, nullptr);
            if (chars) {
                path = chars;
                env->ReleaseStringUTFChars(pathStr, chars);
            }
            env->DeleteLocalRef(pathStr);
        }
    }
    env->DeleteLocalRef(fileClass);
    env->DeleteLocalRef(filesDirObj);
    return path;
}

bool writeFile(const std::string& path, const std::string& content) {
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    if (!file.is_open()) {
        LOGE("无法写入文件: %s", path.c_str());
        return false;
    }
    file.write(content.data(), content.size());
    file.close();
    return true;
}

std::string readFile(const std::string& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) return "";
    std::stringstream ss;
    ss << file.rdbuf();
    return ss.str();
}

bool fileExists(const std::string& path) {
    struct stat st;
    return stat(path.c_str(), &st) == 0;
}

bool mkdirRecursive(const std::string& path) {
    if (path.empty()) return false;
    if (fileExists(path)) return true;

    size_t pos = path.find_last_of('/');
    if (pos != std::string::npos && pos > 0) {
        if (!mkdirRecursive(path.substr(0, pos))) return false;
    }
    return mkdir(path.c_str(), 0777) == 0 || errno == EEXIST;
}

bool removeDir(const std::string& path) {
    DIR* dir = opendir(path.c_str());
    if (!dir) return false;

    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        std::string name(entry->d_name);
        if (name == "." || name == "..") continue;
        std::string fullPath = path + "/" + name;
        struct stat st;
        if (stat(fullPath.c_str(), &st) == 0) {
            if (S_ISDIR(st.st_mode)) {
                removeDir(fullPath);
            } else {
                unlink(fullPath.c_str());
            }
        }
    }
    closedir(dir);
    rmdir(path.c_str());
    return true;
}

// ── SharedPreferences 读写（同步时间戳）──

int64_t getLastSyncTime(JNIEnv* env, jobject context) {
    jclass ctxClass = env->GetObjectClass(context);
    jmethodID getSharedPreferences = env->GetMethodID(ctxClass,
        "getSharedPreferences", "(Ljava/lang/String;I)Landroid/content/SharedPreferences;");
    if (!getSharedPreferences) {
        env->DeleteLocalRef(ctxClass);
        return 0;
    }

    jstring jPrefsName = env->NewStringUTF(PREFS_NAME);
    jobject prefs = env->CallObjectMethod(context, getSharedPreferences, jPrefsName, 0);
    env->DeleteLocalRef(jPrefsName);
    env->DeleteLocalRef(ctxClass);
    if (!prefs) return 0;

    jclass prefsClass = env->GetObjectClass(prefs);
    jmethodID getLong = env->GetMethodID(prefsClass, "getLong",
        "(Ljava/lang/String;J)J");
    int64_t result = 0;
    if (getLong) {
        jstring jKey = env->NewStringUTF(KEY_LAST_SYNC);
        result = env->CallLongMethod(prefs, getLong, jKey, 0LL);
        env->DeleteLocalRef(jKey);
    }
    env->DeleteLocalRef(prefsClass);
    env->DeleteLocalRef(prefs);
    return result;
}

void updateSyncTime(JNIEnv* env, jobject context, int64_t timestamp) {
    jclass ctxClass = env->GetObjectClass(context);
    jmethodID getSharedPreferences = env->GetMethodID(ctxClass,
        "getSharedPreferences", "(Ljava/lang/String;I)Landroid/content/SharedPreferences;");
    if (!getSharedPreferences) {
        env->DeleteLocalRef(ctxClass);
        return;
    }

    jstring jPrefsName = env->NewStringUTF(PREFS_NAME);
    jobject prefs = env->CallObjectMethod(context, getSharedPreferences, jPrefsName, 0);
    env->DeleteLocalRef(jPrefsName);
    env->DeleteLocalRef(ctxClass);
    if (!prefs) return;

    jclass prefsClass = env->GetObjectClass(prefs);
    jmethodID edit = env->GetMethodID(prefsClass, "edit",
        "()Landroid/content/SharedPreferences$Editor;");
    jobject editor = env->CallObjectMethod(prefs, edit);
    env->DeleteLocalRef(prefsClass);
    env->DeleteLocalRef(prefs);
    if (!editor) return;

    jclass editorClass = env->GetObjectClass(editor);
    jmethodID putLong = env->GetMethodID(editorClass, "putLong",
        "(Ljava/lang/String;J)Landroid/content/SharedPreferences$Editor;");
    jmethodID apply = env->GetMethodID(editorClass, "apply", "()V");

    if (putLong && apply) {
        jstring jKey = env->NewStringUTF(KEY_LAST_SYNC);
        env->CallObjectMethod(editor, putLong, jKey, static_cast<jlong>(timestamp));
        env->DeleteLocalRef(jKey);
        env->CallVoidMethod(editor, apply);
        LOGD("同步时间戳已更新: %lld", static_cast<long long>(timestamp));
    }
    env->DeleteLocalRef(editorClass);
    env->DeleteLocalRef(editor);
}

// ── BJT 00:00 同步调度 ──

bool shouldSync(int64_t lastSync) {
    if (lastSync == 0) return true;  // 从未同步

    auto now = std::chrono::system_clock::now();
    int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()).count();

    // BJT = UTC + 8h。将当前时间换算到 BJT 时间线，
    // 找到今天 BJT 00:00，再换算回 UTC 毫秒时间戳。
    const int64_t EIGHT_HOURS_MS = 8LL * 3600 * 1000;
    const int64_t ONE_DAY_MS     = 24LL * 3600 * 1000;

    int64_t nowBjt           = nowMs + EIGHT_HOURS_MS;
    int64_t todayMidnightBjt = (nowBjt / ONE_DAY_MS) * ONE_DAY_MS;
    int64_t todayMidnightUtc = todayMidnightBjt - EIGHT_HOURS_MS;

    return lastSync < todayMidnightUtc;
}

// ── MKA 格式校验 ──

bool validateMka(const std::string& content) {
    return mkaParse(content).has_value();
}

// ── 从 assets 提取 CA 证书包（用于 HTTPS 证书验证）──
// 返回提取后的文件路径，失败返回空字符串

std::string extractCaBundle(JNIEnv* env, jobject context,
                             const std::string& filesDir) {
    std::string destPath = filesDir + "/cacert.pem";

    // 幂等：已存在则直接返回路径
    if (fileExists(destPath)) {
        return destPath;
    }

    jclass ctxClass = env->GetObjectClass(context);
    jmethodID getAssets = env->GetMethodID(ctxClass, "getAssets",
                                            "()Landroid/content/res/AssetManager;");
    if (!getAssets) {
        env->DeleteLocalRef(ctxClass);
        return "";
    }
    jobject assetManagerObj = env->CallObjectMethod(context, getAssets);
    env->DeleteLocalRef(ctxClass);
    if (!assetManagerObj) return "";

    AAssetManager* mgr = AAssetManager_fromJava(env, assetManagerObj);
    env->DeleteLocalRef(assetManagerObj);
    if (!mgr) return "";

    AAsset* asset = AAssetManager_open(mgr, "native/cacert.pem", AASSET_MODE_BUFFER);
    if (!asset) {
        LOGW("assets 中未找到 CA 证书包: native/cacert.pem");
        return "";
    }

    off_t length = AAsset_getLength(asset);
    const char* buf = static_cast<const char*>(AAsset_getBuffer(asset));
    if (buf && length > 0) {
        std::string content(buf, static_cast<size_t>(length));
        if (writeFile(destPath, content)) {
            LOGI("CA 证书包提取成功: %s (%ld bytes)", destPath.c_str(), static_cast<long>(length));
            AAsset_close(asset);
            return destPath;
        }
    }
    AAsset_close(asset);
    return "";
}

} // namespace

// 将 dismissed ID 集合构建为 JSON 数组字符串
static std::string buildDismissedJson(const std::set<std::string>& ids) {
    std::string json = "[";
    bool first = true;
    for (const auto& id : ids) {
        if (!first) json += ",";
        first = false;
        json += "\"";
        for (char c : id) {
            if (c == '"') json += "\\\"";
            else if (c == '\\') json += "\\\\";
            else json += c;
        }
        json += "\"";
    }
    json += "]";
    return json;
}

void markAnnouncementDismissed(JNIEnv* env, jobject context, const std::string& announcementId) {
    // 1. 读取当前 dismissed 集合
    auto dismissedIds = getDismissedIds(env, context);

    // 2. 添加新 ID（已存在则跳过）
    if (!dismissedIds.insert(announcementId).second) {
        LOGD("公告 %s 已在 dismissed 集合中，跳过", announcementId.c_str());
        return;
    }

    // 3. 构建 JSON 数组字符串
    std::string json = buildDismissedJson(dismissedIds);

    // 4. 写入 SharedPreferences
    jclass ctxClass = env->GetObjectClass(context);
    jmethodID getSharedPreferences = env->GetMethodID(ctxClass,
        "getSharedPreferences", "(Ljava/lang/String;I)Landroid/content/SharedPreferences;");
    if (!getSharedPreferences) {
        env->DeleteLocalRef(ctxClass);
        LOGE("无法找到 getSharedPreferences 方法");
        return;
    }

    jstring jPrefsName = env->NewStringUTF(PREFS_NAME);
    jobject prefs = env->CallObjectMethod(context, getSharedPreferences, jPrefsName, 0);
    env->DeleteLocalRef(jPrefsName);
    env->DeleteLocalRef(ctxClass);
    if (!prefs) {
        LOGE("getSharedPreferences 返回 null");
        return;
    }

    jclass prefsClass = env->GetObjectClass(prefs);
    jmethodID edit = env->GetMethodID(prefsClass, "edit",
        "()Landroid/content/SharedPreferences$Editor;");
    if (!edit) {
        env->DeleteLocalRef(prefsClass);
        env->DeleteLocalRef(prefs);
        return;
    }
    jobject editor = env->CallObjectMethod(prefs, edit);
    env->DeleteLocalRef(prefsClass);
    env->DeleteLocalRef(prefs);
    if (!editor) return;

    jclass editorClass = env->GetObjectClass(editor);
    jmethodID putString = env->GetMethodID(editorClass, "putString",
        "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/SharedPreferences$Editor;");
    jmethodID apply = env->GetMethodID(editorClass, "apply", "()V");

    if (putString && apply) {
        jstring jKey = env->NewStringUTF(KEY_DISMISSED);
        jstring jValue = env->NewStringUTF(json.c_str());
        env->CallObjectMethod(editor, putString, jKey, jValue);
        env->DeleteLocalRef(jKey);
        env->DeleteLocalRef(jValue);
        env->CallVoidMethod(editor, apply);
        LOGI("已标记公告不再显示: %s（共 %zu 条）", announcementId.c_str(), dismissedIds.size());
    }

    env->DeleteLocalRef(editorClass);
    env->DeleteLocalRef(editor);
}

// ============================================================================
// AnnouncementManager — 编排：扫描 → 解析 → 过滤 → 排序 → JSON
// ============================================================================

std::string loadVisibleAnnouncementsJson(JNIEnv* env, jobject context) {
    // 1. 扫描所有 .mka 文件（内部存储优先，其次 assets）
    std::vector<std::string> rawFiles;

    auto internal = scanInternalStorage(env, context);
    rawFiles.insert(rawFiles.end(), internal.begin(), internal.end());

    auto assets = scanAssets(env, context);
    rawFiles.insert(rawFiles.end(), assets.begin(), assets.end());

    if (rawFiles.empty()) {
        LOGI("未找到任何 .mka 文件");
        return "[]";
    }

    // 2. 读取已 dismissed 的公告 id 集合
    std::set<std::string> dismissedIds = getDismissedIds(env, context);

    // 2.1 当前版本 versionCode（hidden_at 门槛比较基准）
    int currentVersionCode = getCurrentVersionCode(env, context);

    // 3. 解析并过滤，按 id 去重（内部存储优先扫描，同 id 仅保留第一份）
    std::vector<AnnouncementData> visible;
    std::set<std::string> seenIds;
    for (const auto& raw : rawFiles) {
        auto parsed = mkaParse(raw);
        if (!parsed) {
            LOGW("跳过格式无效的 .mka 文件");
            continue;
        }
        // 去重：同一 id 的公告只保留第一份（内部存储优先）
        if (seenIds.count(parsed->id)) {
            LOGD("公告 %s 已存在（来自更高优先级来源），跳过重复项", parsed->id.c_str());
            continue;
        }
        seenIds.insert(parsed->id);
        // 过滤已 dismissed 的公告（id 在集合中则不显示）
        if (dismissedIds.count(parsed->id)) {
            LOGD("公告 %s 已被标记不再显示，跳过", parsed->id.c_str());
            continue;
        }
        // 过滤旧版 OnlineAnnouncement（id 为 online-announcement），新版本不再加载
        if (parsed->id == "online-announcement") {
            LOGD("公告 %s 为旧版 OnlineAnnouncement，新版本跳过", parsed->id.c_str());
            continue;
        }
        // hidden_at 门槛：仅更新公告携带。
        // 未设置(hiddenAt==0) → 直接显示；
        // 已设置 → 当前版本 versionCode >= hiddenAt 时不显示（已达标）。
        if (parsed->hiddenAt > 0 && currentVersionCode >= parsed->hiddenAt) {
            LOGD("公告 %s 已达更新门槛 hidden_at=%d（当前 versionCode=%d），跳过",
                 parsed->id.c_str(), parsed->hiddenAt, currentVersionCode);
            continue;
        }
        visible.push_back(std::move(*parsed));
    }

    if (visible.empty()) {
        LOGI("无可显示的公告");
        return "[]";
    }

    // 4. 按 priority 降序排列
    std::sort(visible.begin(), visible.end(),
        [](const AnnouncementData& a, const AnnouncementData& b) {
            return a.priority > b.priority;
        });

    // 5. 构建 JSON 数组字符串
    std::string json = "[";
    for (size_t i = 0; i < visible.size(); ++i) {
        const auto& a = visible[i];
        if (i > 0) json += ",";

        json += "{";
        json += "\"id\":\""       + jsonEscape(a.id) + "\"";
        json += ",\"version\":\""  + jsonEscape(a.version) + "\"";
        json += ",\"date\":\""     + jsonEscape(a.date) + "\"";
        json += ",\"priority\":"   + std::to_string(a.priority);
        json += ",\"title\":\""    + jsonEscape(a.title) + "\"";

        // controls 数组
        json += ",\"controls\":[";
        for (size_t j = 0; j < a.controls.size(); ++j) {
            if (j > 0) json += ",";
            json += "\"" + jsonEscape(a.controls[j]) + "\"";
        }
        json += "]";

        json += ",\"content\":\""  + jsonEscape(a.content) + "\"";
        json += "}";
    }
    json += "]";

    LOGI("已加载 %zu 条可显示公告", visible.size());
    return json;
}

// ============================================================================
// RemoteProvider — 公共 API（在线公告同步）
// ============================================================================

bool syncRemoteAnnouncements(JNIEnv* env, jobject context) {
    if (!context) {
        LOGE("syncRemoteAnnouncements: context 为 null");
        return false;
    }

    try {
        // 1. 检查是否需要同步（BJT 00:00 界限）
        int64_t lastSync = getLastSyncTime(env, context);
        if (!shouldSync(lastSync)) {
            LOGD("今日已同步，跳过");
            return true;
        }

        // 2. 获取内部存储路径
        std::string filesDir = getFilesDirPath(env, context);
        if (filesDir.empty()) {
            LOGE("无法获取 filesDir");
            return false;
        }
        std::string cacheDir = filesDir + "/" + INTERNAL_ANNOUNCEMENTS_DIR;
        std::string tempDir  = filesDir + "/" + TEMP_ANNOUNCEMENTS_DIR;

        // 3. 提取 CA 证书包（mbedTLS 不内置 CA 包，HTTPS 验证需要）
        std::string caCertPath = extractCaBundle(env, context, filesDir);

        // 4. 下载远程 state.json
        std::string stateUrl = std::string(REMOTE_BASE_URL) + STATE_JSON_FILENAME;
        auto [stateOk, stateData] = httpGet(stateUrl, caCertPath);
        if (!stateOk) {
            LOGW("下载 state.json 失败，保留缓存");
            return false;
        }

        // 4. 计算远程 state.json 的 SHA-256
        std::string remoteStateSha = sha256Hex(stateData);

        // 5. 读取本地 state.json 并计算 SHA-256
        std::string localStatePath = cacheDir + "/" + STATE_JSON_FILENAME;
        std::string localStateData = readFile(localStatePath);
        std::string localStateSha  = localStateData.empty() ? "" : sha256Hex(localStateData);

        // 6. SHA-256 比较：一致则跳过下载，仅更新时间戳
        if (!localStateSha.empty() && localStateSha == remoteStateSha) {
            LOGI("state.json SHA-256 一致，跳过下载，仅更新同步时间戳");
            auto now = std::chrono::system_clock::now();
            int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();
            updateSyncTime(env, context, nowMs);
            return true;
        }

        // 7. SHA-256 不一致（或首次同步）：解析 state.json 并下载文件
        auto entries = parseStateJson(stateData);
        if (entries.empty()) {
            LOGW("state.json 无有效条目，保留缓存");
            return false;
        }

        LOGI("state.json 变化，开始下载 %zu 个公告文件", entries.size());

        // 8. 清理旧临时目录并创建新临时目录
        if (fileExists(tempDir)) {
            removeDir(tempDir);
        }
        if (!mkdirRecursive(tempDir)) {
            LOGE("无法创建临时目录: %s", tempDir.c_str());
            return false;
        }

        // 9. 逐文件下载、校验、写入临时目录
        int successCount = 0;
        for (const auto& entry : entries) {
            std::string fileUrl = std::string(REMOTE_BASE_URL) + entry.filename;
            auto [fileOk, fileData] = httpGet(fileUrl, caCertPath);
            if (!fileOk) {
                LOGW("下载 %s 失败，跳过", entry.filename.c_str());
                continue;
            }

            // SHA-256 校验
            std::string actualSha = sha256Hex(fileData);
            if (actualSha != entry.sha256) {
                LOGW("SHA-256 校验失败: %s (期望=%s, 实际=%s)",
                     entry.filename.c_str(), entry.sha256.c_str(), actualSha.c_str());
                continue;
            }

            // MKA 格式校验
            if (!validateMka(fileData)) {
                LOGW("MKA 格式无效: %s", entry.filename.c_str());
                continue;
            }

            // 写入临时目录
            std::string tempPath = tempDir + "/" + entry.filename;
            if (!writeFile(tempPath, fileData)) {
                LOGW("写入临时文件失败: %s", tempPath.c_str());
                continue;
            }
            successCount++;
            LOGI("文件校验通过: %s", entry.filename.c_str());
        }

        // 10. 将 state.json 也写入临时目录（供下次 SHA 比较）
        std::string tempStatePath = tempDir + "/" + STATE_JSON_FILENAME;
        writeFile(tempStatePath, stateData);

        // 11. 原子提交：删除旧缓存目录，重命名临时目录为缓存目录
        if (successCount > 0) {
            if (fileExists(cacheDir)) {
                removeDir(cacheDir);
            }
            if (rename(tempDir.c_str(), cacheDir.c_str()) != 0) {
                LOGE("重命名临时目录失败: %s → %s", tempDir.c_str(), cacheDir.c_str());
                removeDir(tempDir);
                return false;
            }

            // 12. 更新同步时间戳
            auto now = std::chrono::system_clock::now();
            int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();
            updateSyncTime(env, context, nowMs);

            LOGI("同步成功: %d 个文件已更新", successCount);
            return true;
        } else {
            // 无有效文件，保留旧缓存
            LOGW("无有效文件可提交，保留旧缓存");
            removeDir(tempDir);
            return false;
        }
    } catch (const std::exception& e) {
        LOGE("同步异常: %s", e.what());
        return false;
    } catch (...) {
        LOGE("同步发生未知异常");
        return false;
    }
}

// ============================================================================
// JNI 入口（由 JNIOnLoad.cpp 注册到 AnnouncementBridge）
// ============================================================================

extern "C" {

// 获取所有可显示的公告（JSON 数组字符串），失败返回空串
jstring ann_nativeGetVisibleAnnouncements(JNIEnv* env, jclass /*clazz*/, jobject context) {
    if (!context) {
        LOGE("context 为 null");
        return env->NewStringUTF("[]");
    }
    std::string json;
    try {
        json = loadVisibleAnnouncementsJson(env, context);
    } catch (const std::exception& e) {
        LOGE("加载公告异常: %s", e.what());
        json = "[]";
    } catch (...) {
        LOGE("加载公告发生未知异常");
        json = "[]";
    }
    return env->NewStringUTF(json.c_str());
}

// 标记公告不再显示
void ann_nativeMarkDontShow(JNIEnv* env, jclass /*clazz*/, jobject context, jstring announcementId) {
    if (!context || !announcementId) {
        LOGE("markDontShow 参数为 null");
        return;
    }
    const char* chars = env->GetStringUTFChars(announcementId, nullptr);
    if (!chars) return;
    std::string id(chars);
    env->ReleaseStringUTFChars(announcementId, chars);

    try {
        markAnnouncementDismissed(env, context, id);
    } catch (const std::exception& e) {
        LOGE("标记公告异常: %s", e.what());
    } catch (...) {
        LOGE("标记公告发生未知异常");
    }
}

// 检查并执行远程同步（BJT 00:00 界限，后台线程，不阻塞 UI）
// 返回值：true=同步完成或跳过；false=同步异常（不影响公告显示）
jboolean ann_nativeSyncIfNeeded(JNIEnv* env, jclass /*clazz*/, jobject context) {
    if (!context) {
        LOGE("syncIfNeeded: context 为 null");
        return JNI_FALSE;
    }
    bool result = false;
    try {
        result = syncRemoteAnnouncements(env, context);
    } catch (const std::exception& e) {
        LOGE("同步异常: %s", e.what());
        result = false;
    } catch (...) {
        LOGE("同步发生未知异常");
        result = false;
    }
    return result ? JNI_TRUE : JNI_FALSE;
}

} // extern "C"
