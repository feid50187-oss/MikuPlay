#include "CdpProxy.h"

#include <android/log.h>
#include <cstring>
#include <cstdlib>
#include <chrono>
#include <fstream>
#include <algorithm>
#include <random>
#include <sstream>
#include <sys/un.h>
#include <unistd.h>
#include <sys/types.h>

namespace mikuplay::cdp {

// ============================================================================
// 字符串感知的 JSON 工具（不依赖第三方库）
// 关键：能正确跳过字符串字面量内的 '{' '}' '"' 等，避免误判对象边界
// ============================================================================

namespace jsonutil {

// 跳过从 startPos（必须是 '"'）开始的 JSON 字符串，返回结束 '"' 的位置
// 找不到返回 npos
static size_t skipJsonString(const std::string& s, size_t startPos) {
    if (startPos >= s.size() || s[startPos] != '"') return std::string::npos;
    size_t pos = startPos + 1;
    while (pos < s.size()) {
        char c = s[pos];
        if (c == '\\' && pos + 1 < s.size()) {
            pos += 2; // 跳过转义字符（如 \" \\ \/ \n 等）
            continue;
        }
        if (c == '"') {
            return pos; // 返回结束引号位置
        }
        pos++;
    }
    return std::string::npos;
}

// 检查 pos 位置是否在字符串字面量内（从 json 开头扫描到 pos）
static bool isInsideString(const std::string& json, size_t pos) {
    bool inString = false;
    size_t i = 0;
    while (i < pos && i < json.size()) {
        char c = json[i];
        if (c == '\\' && i + 1 < json.size() && inString) {
            i += 2;
            continue;
        }
        if (c == '"') inString = !inString;
        i++;
    }
    return inString;
}

// 在 JSON 中找到第一个 "type":"page" 键值对中 "type" 键的 '"' 位置
// 字符串感知：不会匹配字符串字面量内的 "type"
// 找不到返回 npos
static size_t findTypePageKey(const std::string& json) {
    size_t pos = 0;
    while (pos < json.size()) {
        char c = json[pos];
        if (c == '\\' && pos + 1 < json.size()) {
            pos += 2;
            continue;
        }
        if (c != '"') {
            pos++;
            continue;
        }
        // 字符串起始。先取出字符串内容判断是否为 "type"
        size_t strEnd = skipJsonString(json, pos);
        if (strEnd == std::string::npos) return std::string::npos;
        std::string content = json.substr(pos + 1, strEnd - pos - 1);
        if (content == "type") {
            // 找到 "type" 键，验证值是否为 "page"
            size_t after = strEnd + 1;
            while (after < json.size() && (json[after] == ' ' || json[after] == '\t' ||
                                            json[after] == '\n' || json[after] == '\r')) after++;
            if (after < json.size() && json[after] == ':') {
                after++;
                while (after < json.size() && (json[after] == ' ' || json[after] == '\t' ||
                                                json[after] == '\n' || json[after] == '\r')) after++;
                if (after < json.size() && json[after] == '"') {
                    size_t valEnd = skipJsonString(json, after);
                    if (valEnd != std::string::npos) {
                        std::string val = json.substr(after + 1, valEnd - after - 1);
                        if (val == "page") {
                            CDP_LOGI("findTypePageKey: matched 'type':'page' at keyPos=%zu", pos);
                            return pos;
                        }
                    }
                }
            }
        }
        pos = strEnd + 1;
    }
    CDP_LOGW("findTypePageKey: no 'type':'page' key found");
    return std::string::npos;
}

// 找到包含 keyPos 位置的 JSON 对象的起始 '{' 位置（字符串感知）
// 用栈跟踪嵌套对象，找到包含 keyPos 的最内层 '{'
static size_t findEnclosingObjectStart(const std::string& json, size_t keyPos) {
    if (keyPos >= json.size()) return std::string::npos;
    std::vector<size_t> stack;
    size_t pos = 0;
    while (pos < keyPos) {
        char c = json[pos];
        if (c == '\\' && pos + 1 < json.size()) {
            pos += 2;
            continue;
        }
        if (c == '"') {
            size_t end = skipJsonString(json, pos);
            if (end == std::string::npos) return std::string::npos;
            pos = end + 1;
            continue;
        }
        if (c == '{') {
            stack.push_back(pos);
        } else if (c == '}') {
            if (!stack.empty()) stack.pop_back();
        }
        pos++;
    }
    if (stack.empty()) {
        CDP_LOGE("findEnclosingObjectStart: no enclosing object found for pos=%zu", keyPos);
        return std::string::npos;
    }
    return stack.back();
}

// 找到从 objStartPos（必须是 '{'）开始的对象对应的 '}' 位置
// 找不到返回 npos
static size_t findMatchingObjectEnd(const std::string& json, size_t objStartPos) {
    if (objStartPos >= json.size() || json[objStartPos] != '{') return std::string::npos;
    int depth = 0;
    size_t pos = objStartPos;
    while (pos < json.size()) {
        char c = json[pos];
        if (c == '\\' && pos + 1 < json.size()) {
            pos += 2;
            continue;
        }
        if (c == '"') {
            size_t end = skipJsonString(json, pos);
            if (end == std::string::npos) return std::string::npos;
            pos = end + 1;
            continue;
        }
        if (c == '{') {
            depth++;
        } else if (c == '}') {
            depth--;
            if (depth == 0) return pos;
        }
        pos++;
    }
    return std::string::npos;
}

// 从 JSON 字符串中提取 key 对应的字符串值（字符串感知）
static std::string extractString(const std::string& json, const std::string& key) {
    std::string keyPattern = "\"" + key + "\"";
    size_t pos = 0;
    while (pos < json.size()) {
        size_t keyPos = json.find(keyPattern, pos);
        if (keyPos == std::string::npos) return {};

        // 字符串感知：跳过位于字符串字面量内的误匹配
        if (isInsideString(json, keyPos)) {
            pos = keyPos + keyPattern.size();
            continue;
        }

        size_t after = keyPos + keyPattern.size();
        while (after < json.size() && (json[after] == ' ' || json[after] == '\t' ||
                                        json[after] == '\n' || json[after] == '\r')) after++;
        if (after >= json.size() || json[after] != ':') {
            pos = keyPos + keyPattern.size();
            continue;
        }
        after++;
        while (after < json.size() && (json[after] == ' ' || json[after] == '\t' ||
                                        json[after] == '\n' || json[after] == '\r')) after++;

        if (after >= json.size() || json[after] != '"') {
            pos = keyPos + keyPattern.size();
            continue;
        }

        size_t valEnd = skipJsonString(json, after);
        if (valEnd == std::string::npos) return {};

        std::string result;
        for (size_t i = after + 1; i < valEnd; ++i) {
            if (json[i] == '\\' && i + 1 < valEnd) {
                char next = json[i + 1];
                switch (next) {
                    case '"':  result += '"'; break;
                    case '\\': result += '\\'; break;
                    case '/':  result += '/'; break;
                    case 'b':  result += '\b'; break;
                    case 'f':  result += '\f'; break;
                    case 'n':  result += '\n'; break;
                    case 'r':  result += '\r'; break;
                    case 't':  result += '\t'; break;
                    default:   result += next; break;
                }
                i++;
            } else {
                result += json[i];
            }
        }
        return result;
    }
    return {};
}

// 检查 JSON 是否包含指定字段（字符串感知）
static bool hasField(const std::string& json, const std::string& key) {
    std::string keyPattern = "\"" + key + "\"";
    size_t pos = 0;
    while (pos < json.size()) {
        size_t keyPos = json.find(keyPattern, pos);
        if (keyPos == std::string::npos) return false;
        if (isInsideString(json, keyPos)) {
            pos = keyPos + keyPattern.size();
            continue;
        }
        return true;
    }
    return false;
}

// 从 JSON 提取 "id" 的整数值（字符串感知，仅匹配数字 id）
static int extractId(const std::string& json) {
    std::string keyPattern = "\"id\"";
    size_t pos = 0;
    while (pos < json.size()) {
        size_t keyPos = json.find(keyPattern, pos);
        if (keyPos == std::string::npos) return -1;
        if (isInsideString(json, keyPos)) {
            pos = keyPos + keyPattern.size();
            continue;
        }
        size_t after = keyPos + keyPattern.size();
        while (after < json.size() && (json[after] == ' ' || json[after] == '\t' ||
                                        json[after] == '\n' || json[after] == '\r')) after++;
        if (after >= json.size() || json[after] != ':') {
            pos = keyPos + keyPattern.size();
            continue;
        }
        after++;
        while (after < json.size() && (json[after] == ' ' || json[after] == '\t' ||
                                        json[after] == '\n' || json[after] == '\r')) after++;
        if (after >= json.size() || json[after] < '0' || json[after] > '9') {
            pos = keyPos + keyPattern.size();
            continue;
        }
        int id = 0;
        while (after < json.size() && json[after] >= '0' && json[after] <= '9') {
            id = id * 10 + (json[after] - '0');
            after++;
        }
        return id;
    }
    return -1;
}

// 转义 JSON 字符串值
static std::string escape(const std::string& s) {
    std::string out;
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:   out += c; break;
        }
    }
    return out;
}

// 构建 CDP 命令 JSON
static std::string buildCommand(int id, const std::string& method, const std::string& paramsJson) {
    std::string json = R"({"id":)" + std::to_string(id) +
                       R"(,"method":")" + escape(method) + R"(")";
    if (!paramsJson.empty() && paramsJson != "{}") {
        json += R"(,"params":)" + paramsJson;
    }
    json += "}";
    return json;
}

// 从 targets JSON 数组中找到第一个 type=page 的 target 的 webSocketDebuggerUrl
// 字符串感知的实现：使用 findTypePageKey + findEnclosingObjectStart + findMatchingObjectEnd
// 这样可以正确处理 description 字段内嵌的 {}，避免错把 description 内部的 '{' 当作对象起点
static std::string findPageTargetWsUrl(const std::string& json) {
    size_t typeKeyPos = findTypePageKey(json);
    if (typeKeyPos == std::string::npos) return {};

    size_t objStart = findEnclosingObjectStart(json, typeKeyPos);
    if (objStart == std::string::npos) return {};

    size_t objEnd = findMatchingObjectEnd(json, objStart);
    if (objEnd == std::string::npos) return {};

    CDP_LOGI("findPageTargetWsUrl: page target object at [%zu, %zu], size=%zu",
             objStart, objEnd, objEnd - objStart + 1);

    std::string obj = json.substr(objStart, objEnd - objStart + 1);
    std::string wsUrl = extractString(obj, "webSocketDebuggerUrl");

    if (wsUrl.empty()) {
        CDP_LOGW("findPageTargetWsUrl: 'webSocketDebuggerUrl' not found in page target object");
        // 打印前 300 字符便于排查
        std::string excerpt = obj.substr(0, std::min<size_t>(obj.size(), 300));
        CDP_LOGW("findPageTargetWsUrl: object excerpt: %s", excerpt.c_str());
    } else {
        CDP_LOGI("findPageTargetWsUrl: webSocketDebuggerUrl=%s", wsUrl.c_str());
    }
    return wsUrl;
}

// 从 targets JSON 中提取第一个 type=page 的 target 的 id 字段
// 用于 webSocketDebuggerUrl 缺失时的回退路径构造
static std::string findPageTargetId(const std::string& json) {
    size_t typeKeyPos = findTypePageKey(json);
    if (typeKeyPos == std::string::npos) return {};
    size_t objStart = findEnclosingObjectStart(json, typeKeyPos);
    if (objStart == std::string::npos) return {};
    size_t objEnd = findMatchingObjectEnd(json, objStart);
    if (objEnd == std::string::npos) return {};
    std::string obj = json.substr(objStart, objEnd - objStart + 1);
    std::string id = extractString(obj, "id");
    if (!id.empty()) {
        CDP_LOGI("findPageTargetId: page target id=%s", id.c_str());
    } else {
        CDP_LOGW("findPageTargetId: 'id' not found in page target object");
    }
    return id;
}

} // namespace jsonutil

// ============================================================================
// 构造 / 析构
// ============================================================================

CdpProxy::CdpProxy(Config cfg) : cfg_(std::move(cfg)) {}
CdpProxy::~CdpProxy() { stop(); }

// ============================================================================
// 公开接口
// ============================================================================

std::string CdpProxy::endpointUrl() const {
    return "http://127.0.0.1:" + std::to_string(actualPort_);
}

std::string CdpProxy::abstractSocketName() const { return sockName_; }

bool CdpProxy::start() {
    if (running_.load()) return true;

    // 1) 探测抽象 socket 名
    sockName_ = discoverAbstractSocketName(cfg_.preferPid, cfg_.abstractOverride);
    if (sockName_.empty()) {
        CDP_LOGE("Failed to discover abstract socket name");
        return false;
    }
    CDP_LOGI("Discovered abstract socket: %s", sockName_.c_str());

    // 2) 连通性校验
    int probeFd = probeAbstractSocket(sockName_);
    if (probeFd < 0) {
        CDP_LOGE("Abstract socket not reachable: %s", sockName_.c_str());
        return false;
    }
    ::close(probeFd);

    // 3) 获取 target 列表，找到 page target
    std::string targetsRaw = fetchTargetsFromDevTools();
    pageTargetPath_ = "/devtools/page/page"; // 默认

    if (!targetsRaw.empty()) {
        std::string wsUrl = jsonutil::findPageTargetWsUrl(targetsRaw);
        if (!wsUrl.empty()) {
            auto pathStart = wsUrl.find("/devtools/");
            if (pathStart != std::string::npos) {
                pageTargetPath_ = wsUrl.substr(pathStart);
                CDP_LOGI("start: page target path from webSocketDebuggerUrl: %s", pageTargetPath_.c_str());
            } else {
                CDP_LOGW("start: webSocketDebuggerUrl has no '/devtools/' prefix: %s", wsUrl.c_str());
            }
        } else {
            // 回退：使用 page target 的 id 字段构造路径（/devtools/page/<id>）
            std::string targetId = jsonutil::findPageTargetId(targetsRaw);
            if (!targetId.empty()) {
                pageTargetPath_ = "/devtools/page/" + targetId;
                CDP_LOGI("start: fallback path constructed from target id: %s", pageTargetPath_.c_str());
            } else {
                CDP_LOGE("start: cannot determine page target path, using default: %s", pageTargetPath_.c_str());
            }
        }
    } else {
        CDP_LOGE("start: empty targets response, using default path: %s", pageTargetPath_.c_str());
    }
    CDP_LOGI("Page target path: %s", pageTargetPath_.c_str());

    // 4) 建立 Chromium WebSocket 连接
    running_ = true;
    if (!ensureChromiumConnection()) {
        CDP_LOGE("Failed to establish Chromium WS connection");
        running_ = false;
        return false;
    }

    // 5) 启动读取线程（若 ensureChromiumConnection 尚未启动）
    if (!readThread_.joinable()) {
        try {
            readThread_ = std::thread(&CdpProxy::chromiumReadThread, this);
        } catch (const std::exception& e) {
            CDP_LOGE("start: failed to create read thread: %s", e.what());
            running_ = false;
            return false;
        }
    }

    CDP_LOGI("CdpProxy started");
    return true;
}

void CdpProxy::stop() {
    if (!running_.load()) return;
    running_ = false;

    {
        std::lock_guard<std::mutex> lock(chromiumMtx_);
        if (chromiumFd_ >= 0) {
            ::shutdown(chromiumFd_, SHUT_RDWR);
            ::close(chromiumFd_);
            chromiumFd_ = -1;
        }
    }

    if (readThread_.joinable()) readThread_.join();

    // 唤醒所有等待中的 sendCommand
    respCv_.notify_all();

    CDP_LOGI("CdpProxy stopped");
}

// ============================================================================
// sendCommand
// ============================================================================

std::string CdpProxy::sendCommand(int id, const std::string& method, const std::string& paramsJson) {
    std::string jsonStr = jsonutil::buildCommand(id, method, paramsJson);
    CDP_LOGI("sendCommand: %s", jsonStr.c_str());

    // 确保连接可用
    if (!ensureChromiumConnection()) {
        CDP_LOGE("sendCommand: no Chromium connection");
        return R"({"id":)" + std::to_string(id) + R"(,"error":{"message":"Not connected"}})";
    }

    // 发送
    {
        std::lock_guard<std::mutex> lock(chromiumMtx_);
        if (!wsClientSendText(chromiumFd_, jsonStr)) {
            CDP_LOGE("sendCommand: send failed");
            ::close(chromiumFd_);
            chromiumFd_ = -1;
            return R"({"id":)" + std::to_string(id) + R"(,"error":{"message":"Send failed"}})";
        }
    }

    // 等待响应（5 秒超时）
    std::unique_lock<std::mutex> lock(respMtx_);
    if (respCv_.wait_for(lock, std::chrono::seconds(5), [&]() {
        return pendingResponses_.count(id) > 0;
    })) {
        std::string resp = std::move(pendingResponses_[id]);
        pendingResponses_.erase(id);
        return resp;
    }

    CDP_LOGW("sendCommand: timeout for id=%d", id);
    return R"({"id":)" + std::to_string(id) + R"(,"error":{"message":"Timeout"}})";
}

// ============================================================================
// Chromium 连接管理
// ============================================================================

bool CdpProxy::ensureChromiumConnection() {
    std::lock_guard<std::mutex> lock(chromiumMtx_);
    if (chromiumFd_ >= 0) return true;

    int fd = connectAbstract(sockName_);
    if (fd < 0) {
        CDP_LOGE("ensureChromiumConnection: connect failed");
        return false;
    }

    if (!wsClientHandshake(fd, pageTargetPath_)) {
        CDP_LOGE("ensureChromiumConnection: WS handshake failed");
        ::close(fd);
        return false;
    }

    chromiumFd_ = fd;
    CDP_LOGI("Chromium WS connection established, fd=%d, path=%s", fd, pageTargetPath_.c_str());

    if (!readThread_.joinable()) {
        try {
            readThread_ = std::thread(&CdpProxy::chromiumReadThread, this);
        } catch (const std::exception& e) {
            CDP_LOGE("ensureChromiumConnection: failed to create read thread: %s", e.what());
            ::close(chromiumFd_);
            chromiumFd_ = -1;
            return false;
        }
    }

    return true;
}

// ============================================================================
// Chromium 读取线程
// ============================================================================

void CdpProxy::chromiumReadThread() {
    CDP_LOGI("Chromium read thread started");

    try {
    while (running_) {
        int fd;
        {
            std::lock_guard<std::mutex> lock(chromiumMtx_);
            fd = chromiumFd_;
        }
        if (fd < 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            continue;
        }

        std::string payload;
        uint8_t opcode = 0;

        if (!wsClientReadFrame(fd, payload, opcode)) {
            CDP_LOGW("Chromium read failed, will reconnect");
            std::lock_guard<std::mutex> lock(chromiumMtx_);
            if (chromiumFd_ == fd) {
                ::close(chromiumFd_);
                chromiumFd_ = -1;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
            continue;
        }

        if (opcode == 0x1 || opcode == 0x2) {
            if (jsonutil::hasField(payload, "id")) {
                // 命令响应
                int id = jsonutil::extractId(payload);
                if (id >= 0) {
                    {
                        std::lock_guard<std::mutex> lock(respMtx_);
                        pendingResponses_[id] = payload;
                    }
                    respCv_.notify_all();
                }
            } else if (jsonutil::hasField(payload, "method")) {
                // CDP 事件
                std::string eventName = jsonutil::extractString(payload, "method");
                CDP_LOGI("CDP event: %s", eventName.c_str());
                if (cfg_.onEvent) {
                    cfg_.onEvent(payload);
                }
            }
        } else if (opcode == 0x8) {
            CDP_LOGI("Chromium sent close frame");
            std::lock_guard<std::mutex> lock(chromiumMtx_);
            if (chromiumFd_ == fd) {
                ::close(chromiumFd_);
                chromiumFd_ = -1;
            }
        } else if (opcode == 0x9) {
            uint8_t pong[2] = {0x8A, 0x00};
            ::send(fd, pong, 2, MSG_NOSIGNAL);
        }
    }
    } catch (const std::exception& e) {
        CDP_LOGE("chromiumReadThread: uncaught std::exception: %s", e.what());
    } catch (...) {
        CDP_LOGE("chromiumReadThread: uncaught unknown exception");
    }

    CDP_LOGI("Chromium read thread exited");
}

// ============================================================================
// 抽象 socket 发现
// ============================================================================

std::string CdpProxy::discoverAbstractSocketName(pid_t prefer, const std::string& override_) {
    if (!override_.empty()) return override_;
    if (const char* env = std::getenv("WEBVIEW_DEVTOOLS_PID")) {
        CDP_LOGI("Using WEBVIEW_DEVTOOLS_PID env: %s", env);
        return "@webview_devtools_remote_" + std::string(env);
    }
    if (auto s = scanProcSelfNetUnix(prefer); !s.empty()) return s;
    if (auto s = scanProcNetUnix();           !s.empty()) return s;
    return fallbackByPid(prefer ? prefer : ::getpid());
}

std::string CdpProxy::scanProcSelfNetUnix(pid_t pid) {
    std::string path = "/proc/" + std::to_string(pid) + "/net/unix";
    std::ifstream ifs(path);
    if (!ifs.is_open()) { CDP_LOGW("Cannot open %s", path.c_str()); return {}; }
    std::string line;
    while (std::getline(ifs, line)) {
        auto pos = line.find("@webview_devtools_remote_");
        if (pos != std::string::npos) {
            std::string name = line.substr(pos);
            while (!name.empty() && (name.back()=='\n'||name.back()=='\r'||name.back()==' '))
                name.pop_back();
            CDP_LOGI("Found in %s: %s", path.c_str(), name.c_str());
            return name;
        }
    }
    return {};
}

std::string CdpProxy::scanProcNetUnix() {
    std::ifstream ifs("/proc/net/unix");
    if (!ifs.is_open()) return {};
    std::string line;
    while (std::getline(ifs, line)) {
        auto pos = line.find("@webview_devtools_remote_");
        if (pos != std::string::npos) {
            std::string name = line.substr(pos);
            while (!name.empty() && (name.back()=='\n'||name.back()=='\r'||name.back()==' '))
                name.pop_back();
            return name;
        }
    }
    return {};
}

std::string CdpProxy::fallbackByPid(pid_t pid) {
    std::string name = "@webview_devtools_remote_" + std::to_string(pid);
    CDP_LOGI("Fallback to pid-based name: %s", name.c_str());
    return name;
}

// ============================================================================
// AF_UNIX 连接
// ============================================================================

int CdpProxy::connectAbstract(const std::string& name) {
    int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return -1;

    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::string n = name;
    if (!n.empty() && n[0] == '@') n.erase(0, 1);
    if (n.size() + 1 >= sizeof(addr.sun_path)) { ::close(fd); return -1; }

    addr.sun_path[0] = '\0';
    std::memcpy(addr.sun_path + 1, n.data(), n.size());
    socklen_t addrLen = offsetof(struct sockaddr_un, sun_path) + 1 + n.size();

    timeval tv{0, 100 * 1000};
    ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    ::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    if (::connect(fd, reinterpret_cast<sockaddr*>(&addr), addrLen) != 0) {
        ::close(fd);
        return -1;
    }
    return fd;
}

int CdpProxy::probeAbstractSocket(const std::string& name) {
    int maxRetries = 8, delayMs = 200;
    for (int i = 0; i < maxRetries; ++i) {
        int fd = connectAbstract(name);
        if (fd >= 0) { CDP_LOGI("Abstract socket reachable on attempt %d", i+1); return fd; }
        CDP_LOGW("Abstract socket not reachable (attempt %d/%d), retry in %dms", i+1, maxRetries, delayMs);
        std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
        delayMs = std::min(delayMs * 2, 2000);
    }
    return -1;
}

// ============================================================================
// HTTP 获取 target 列表
// ============================================================================

std::string CdpProxy::fetchTargetsFromDevTools() {
    int fd = connectAbstract(sockName_);
    if (fd < 0) return {};

    // 增大 recv 超时（connectAbstract 默认 100ms 太短）
    timeval tv{3, 0}; // 3 秒
    ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    const char* req = "GET /json HTTP/1.1\r\nHost: localhost\r\n\r\n";
    if (::send(fd, req, strlen(req), MSG_NOSIGNAL) <= 0) { ::close(fd); return {}; }

    // 循环读取完整 HTTP 响应
    std::string response;
    std::array<char, 4096> buf;
    while (true) {
        ssize_t n = ::recv(fd, buf.data(), buf.size(), 0);
        if (n <= 0) break;
        response.append(buf.data(), n);
        // 检查是否已收到完整 HTTP 响应（header + body 分隔符）
        if (response.find("\r\n\r\n") != std::string::npos) {
            // 检查 Content-Length 或直接认为 body 已接收
            auto hdrEnd = response.find("\r\n\r\n");
            std::string header = response.substr(0, hdrEnd);
            auto clPos = header.find("Content-Length:");
            if (clPos != std::string::npos) {
                int contentLength = std::atoi(header.c_str() + clPos + 15);
                int bodyReceived = response.size() - hdrEnd - 4;
                if (bodyReceived >= contentLength) break;
            } else {
                // 无 Content-Length，等一小段时间再读一次
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
                ssize_t n2 = ::recv(fd, buf.data(), buf.size(), 0);
                if (n2 > 0) response.append(buf.data(), n2);
                break;
            }
        }
    }
    ::close(fd);

    if (response.empty()) {
        CDP_LOGW("fetchTargetsFromDevTools: empty response");
        return {};
    }

    CDP_LOGI("fetchTargetsFromDevTools: response size=%zu", response.size());

    // 单独打印状态行（首行），便于排错
    auto firstLineEnd = response.find("\r\n");
    if (firstLineEnd != std::string::npos) {
        std::string statusLine = response.substr(0, firstLineEnd);
        CDP_LOGI("fetchTargetsFromDevTools: HTTP status: %s", statusLine.c_str());
    }

    auto bodyStart = response.find("\r\n\r\n");
    if (bodyStart == std::string::npos) {
        CDP_LOGW("fetchTargetsFromDevTools: no header/body separator found");
        return {};
    }

    std::string body = response.substr(bodyStart + 4);
    CDP_LOGI("fetchTargetsFromDevTools: body length=%zu", body.size());
    // body 较短时整段打印；较长时打印头部与尾部
    if (body.size() <= 1024) {
        CDP_LOGI("fetchTargetsFromDevTools: body=%s", body.c_str());
    } else {
        std::string head = body.substr(0, 512);
        std::string tail = body.substr(body.size() - 256);
        CDP_LOGI("fetchTargetsFromDevTools: body head[0..512)=%s", head.c_str());
        CDP_LOGI("fetchTargetsFromDevTools: body tail[end-256..end)=%s", tail.c_str());
    }
    return body;
}

// ============================================================================
// WebSocket 客户端 —— 握手
// ============================================================================

bool CdpProxy::wsClientHandshake(int fd, const std::string& path) {
    // 增大 recv 超时
    timeval tv{3, 0};
    ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    std::random_device rd;
    std::array<uint8_t, 16> keyBytes;
    for (auto& b : keyBytes) b = rd() & 0xFF;

    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string clientKey;
    for (size_t i = 0; i < keyBytes.size(); i += 3) {
        uint32_t n = (keyBytes[i] << 16) | (keyBytes[i+1] << 8) | keyBytes[i+2];
        clientKey += b64[(n >> 18) & 0x3F];
        clientKey += b64[(n >> 12) & 0x3F];
        clientKey += b64[(n >> 6)  & 0x3F];
        clientKey += b64[n & 0x3F];
    }

    std::string req = "GET " + path + " HTTP/1.1\r\n"
                      "Host: localhost\r\n"
                      "Upgrade: websocket\r\n"
                      "Connection: Upgrade\r\n"
                      "Sec-WebSocket-Key: " + clientKey + "\r\n"
                      "Sec-WebSocket-Version: 13\r\n\r\n";

    CDP_LOGI("WS handshake request: GET %s", path.c_str());

    if (::send(fd, req.c_str(), req.size(), MSG_NOSIGNAL) <= 0) {
        CDP_LOGE("WS handshake: failed to send upgrade request");
        return false;
    }

    std::array<char, 4096> buf;
    ssize_t n = ::recv(fd, buf.data(), buf.size(), 0);
    if (n <= 0) {
        CDP_LOGE("WS handshake: no response from Chromium (n=%zd)", n);
        return false;
    }

    std::string resp(buf.data(), n);
    if (resp.find("101") == std::string::npos) {
        CDP_LOGE("WS handshake: Chromium did not return 101, got: %s", resp.c_str());
        // 提取并打印状态行
        auto lineEnd = resp.find("\r\n");
        if (lineEnd != std::string::npos) {
            CDP_LOGE("WS handshake: status line: %s", resp.substr(0, lineEnd).c_str());
        }
        // 提取并打印正文（去除响应头）
        auto bodySep = resp.find("\r\n\r\n");
        if (bodySep != std::string::npos) {
            std::string body = resp.substr(bodySep + 4);
            if (!body.empty()) {
                CDP_LOGE("WS handshake: response body: %s", body.c_str());
            }
        }
        return false;
    }

    CDP_LOGI("WS handshake with Chromium succeeded");
    return true;
}

// ============================================================================
// WebSocket 客户端 —— 发送 masked text frame
// ============================================================================

bool CdpProxy::wsClientSendText(int fd, std::string_view payload) {
    size_t len = payload.size();
    std::vector<uint8_t> frame;

    frame.push_back(0x81);

    if (len <= 125) {
        frame.push_back(0x80 | (uint8_t)len);
    } else if (len <= 65535) {
        frame.push_back(0x80 | 126);
        frame.push_back((len >> 8) & 0xFF);
        frame.push_back(len & 0xFF);
    } else {
        frame.push_back(0x80 | 127);
        for (int i = 7; i >= 0; --i)
            frame.push_back((len >> (i * 8)) & 0xFF);
    }

    std::random_device rd;
    uint8_t mask[4];
    for (auto& m : mask) m = rd() & 0xFF;
    frame.insert(frame.end(), mask, mask + 4);

    for (size_t i = 0; i < len; ++i) {
        frame.push_back(payload[i] ^ mask[i % 4]);
    }

    size_t sent = 0;
    while (sent < frame.size()) {
        ssize_t n = ::send(fd, frame.data() + sent, frame.size() - sent, MSG_NOSIGNAL);
        if (n <= 0) return false;
        sent += n;
    }
    return true;
}

// ============================================================================
// WebSocket 客户端 —— 读取 frame
// ============================================================================

static bool recvExact(int fd, uint8_t* buf, size_t n) {
    size_t got = 0;
    while (got < n) {
        ssize_t r = ::recv(fd, buf + got, n - got, 0);
        if (r <= 0) return false;
        got += r;
    }
    return true;
}

bool CdpProxy::wsClientReadFrame(int fd, std::string& outPayload, uint8_t& outOpcode) {
    uint8_t header[2];
    if (!recvExact(fd, header, 2)) return false;

    outOpcode = header[0] & 0x0F;
    bool masked = (header[1] & 0x80) != 0;
    uint64_t payloadLen = header[1] & 0x7F;

    if (payloadLen == 126) {
        uint8_t ext[2];
        if (!recvExact(fd, ext, 2)) return false;
        payloadLen = ((uint16_t)ext[0] << 8) | ext[1];
    } else if (payloadLen == 127) {
        uint8_t ext[8];
        if (!recvExact(fd, ext, 8)) return false;
        payloadLen = 0;
        for (int i = 0; i < 8; ++i) payloadLen = (payloadLen << 8) | ext[i];
    }

    uint8_t mask[4] = {};
    if (masked) {
        if (!recvExact(fd, mask, 4)) return false;
    }

    outPayload.resize(payloadLen);
    if (payloadLen > 0) {
        if (!recvExact(fd, reinterpret_cast<uint8_t*>(outPayload.data()), payloadLen))
            return false;
        if (masked) {
            for (uint64_t i = 0; i < payloadLen; ++i)
                outPayload[i] ^= mask[i % 4];
        }
    }

    return true;
}

} // namespace mikuplay::cdp
