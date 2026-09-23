cmake_minimum_required(VERSION 3.22)
project(mikuplay_encoder)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# uSockets 编译选项：无 SSL，使用 epoll 后端（Android/Linux 默认）
set(USOCKETS_SRC_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/uSockets/src)

add_library(uSockets STATIC
    ${USOCKETS_SRC_DIR}/bsd.c
    ${USOCKETS_SRC_DIR}/context.c
    ${USOCKETS_SRC_DIR}/loop.c
    ${USOCKETS_SRC_DIR}/socket.c
    ${USOCKETS_SRC_DIR}/udp.c
    ${USOCKETS_SRC_DIR}/eventing/epoll_kqueue.c
)

target_include_directories(uSockets PUBLIC
    ${USOCKETS_SRC_DIR}
    ${USOCKETS_SRC_DIR}/internal
)

target_compile_definitions(uSockets PUBLIC
    LIBUS_NO_SSL
    LIBUS_USE_EPOLL
)

target_compile_options(uSockets PRIVATE -O3)

# uWebSockets 是 header-only，只需 include 路径
set(UWEBSOCKETS_SRC_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/uWebSockets/src)

# ============================================================
#  mbedTLS — 从源码编译为静态库（libcurl 的 SSL/TLS 后端，提供 HTTPS 支持）
# ============================================================
set(MBEDTLS_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/mbedtls)
set(ENABLE_PROGRAMS OFF CACHE BOOL "" FORCE)
set(ENABLE_TESTING OFF CACHE BOOL "" FORCE)
set(USE_SHARED_MBEDTLS_LIBRARY OFF CACHE BOOL "" FORCE)
set(USE_STATIC_MBEDTLS_LIBRARY ON CACHE BOOL "" FORCE)
set(MBEDTLS_FATAL_WARNINGS OFF CACHE BOOL "" FORCE)
add_subdirectory(${MBEDTLS_DIR} ${CMAKE_BINARY_DIR}/mbedtls-build EXCLUDE_FROM_ALL)

# ============================================================
#  libcurl — 从源码编译为静态库（用于 RemoteProvider HTTP/HTTPS 请求）
#
#  配置说明：
#  - BUILD_SHARED_LIBS=OFF  静态链接，减少 SO 体积
#  - HTTP_ONLY=ON           仅启用 HTTP/HTTPS 协议，剔除 FTP/SMTP 等
#  - CURL_ENABLE_SSL=ON     启用 SSL（HTTPS 支持）
#  - CURL_USE_MBEDTLS=ON    使用 mbedTLS 作为 SSL 后端
#  - BUILD_CURL_EXE=OFF     不构建 curl 命令行工具
#  - BUILD_TESTING=OFF      不构建测试
#  - PICKY_COMPILER=OFF     关闭严格编译警告（NDK 工具链兼容性）
#
#  find_package 跳过策略：在 add_subdirectory(curl) 之前预设
#  MBEDTLS_* 缓存变量，使 curl 的 find_package(MbedTLS) 直接使用
#  缓存值（CMake target 名称），不再执行文件系统搜索。
# ============================================================
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(BUILD_CURL_EXE OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(HTTP_ONLY ON CACHE BOOL "" FORCE)
set(CURL_ENABLE_SSL ON CACHE BOOL "" FORCE)
set(CURL_USE_OPENSSL OFF CACHE BOOL "" FORCE)
set(CURL_USE_MBEDTLS ON CACHE BOOL "" FORCE)
set(PICKY_COMPILER OFF CACHE BOOL "" FORCE)
set(CURL_DISABLE_INSTALL ON CACHE BOOL "" FORCE)
set(CURL_ENABLE_CA_EMBED OFF CACHE BOOL "" FORCE)
set(CURL_ENABLE_EXPORT_TARGET OFF CACHE BOOL "" FORCE)

# 预设 mbedTLS 缓存变量，使 curl 的 find_package(MbedTLS) 直接命中
# 值为 CMake target 名称，target_link_libraries 会正确解析
set(MBEDTLS_INCLUDE_DIRS ${MBEDTLS_DIR}/include CACHE PATH "mbedTLS include" FORCE)
set(MBEDTLS_LIBRARY     mbedtls     CACHE STRING "mbedTLS library target" FORCE)
set(MBEDX509_LIBRARY    mbedx509    CACHE STRING "mbedx509 library target" FORCE)
set(MBEDCRYPTO_LIBRARY  mbedcrypto  CACHE STRING "mbedcrypto library target" FORCE)
set(MBEDTLS_LIBRARIES   "${MBEDTLS_LIBRARY};${MBEDX509_LIBRARY};${MBEDCRYPTO_LIBRARY}"
    CACHE STRING "mbedTLS libraries" FORCE)

# libcurl 源码目录（避免其 target 污染全局 install/default build）
set(CURL_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/curl)
add_subdirectory(${CURL_DIR} ${CMAKE_BINARY_DIR}/curl-build EXCLUDE_FROM_ALL)

# picosha256 — header-only SHA-256 实现（用于 index.json 与 .mka 完整性校验）
set(PICOSHA256_INCLUDE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/picosha256)

# ============================================================
#  赞赏二维码嵌入 — 构建时转换为 C 头文件，编译进 SO
#
#  使用 Python 脚本替代 xxd -i（Windows 兼容）。
#  产物 qrcode_embedded.h 位于 CMAKE_CURRENT_BINARY_DIR，
#  由 FeedbackResource.cpp #include 引用。
# ============================================================
set(QRCODE_SRC ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../qrcode.jpg)
set(QRCODE_HEADER ${CMAKE_CURRENT_BINARY_DIR}/qrcode_embedded.h)
set(QRCODE_GEN_SCRIPT ${CMAKE_CURRENT_SOURCE_DIR}/../../../../../scripts/generate_qrcode_header.py)

add_custom_command(
    OUTPUT ${QRCODE_HEADER}
    COMMAND ${CMAKE_COMMAND} -E env python ${QRCODE_GEN_SCRIPT}
            ${QRCODE_SRC} ${QRCODE_HEADER}
    DEPENDS ${QRCODE_SRC} ${QRCODE_GEN_SCRIPT}
    COMMENT "Embedding qrcode.jpg into native header"
)

# 创建自定义 target 供 add_dependencies 引用
add_custom_target(generate_qrcode_header DEPENDS ${QRCODE_HEADER})

# ============================================================
#  libvpx — VP8/VP9 编解码器（用于透明视频 Alpha 后合成输出 IVF/WebM）
#
#  使用 NDK 交叉编译生成的预构建静态库。
#  首次构建前，请在 Cygwin 中运行：
#    cd third_party/libvpx && bash build_libvpx_arm64.sh
#  产物位于 third_party/libvpx/build-android-arm64/
# ============================================================
set(LIBVPX_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/libvpx)
set(LIBVPX_PREBUILT_DIR ${LIBVPX_DIR}/build-android-arm64)

if(NOT EXISTS "${LIBVPX_PREBUILT_DIR}/lib/libvpx.a")
    message(FATAL_ERROR
        "libvpx 预构建库未找到！\n"
        "请先在 Cygwin 中运行构建脚本：\n"
        "  cd ${LIBVPX_DIR}\n"
        "  bash build_libvpx_arm64.sh\n"
        "构建完成后重新运行 CMake。")
endif()

add_library(vpx_static STATIC IMPORTED)
set_target_properties(vpx_static PROPERTIES
    IMPORTED_LOCATION ${LIBVPX_PREBUILT_DIR}/lib/libvpx.a
)

# ============================================================
#  libwebm — WebM/Matroska muxer（用于透明视频双流合成）
#  源码随 libvpx 仓库附带：third_party/libvpx/third_party/libwebm/
# ============================================================
set(LIBWEBM_DIR ${LIBVPX_DIR}/third_party/libwebm)

add_library(webm_muxer STATIC
    ${LIBWEBM_DIR}/mkvmuxer/mkvmuxer.cc
    ${LIBWEBM_DIR}/mkvmuxer/mkvmuxerutil.cc
    ${LIBWEBM_DIR}/mkvmuxer/mkvwriter.cc
)
target_include_directories(webm_muxer PUBLIC ${LIBWEBM_DIR})
target_compile_options(webm_muxer PRIVATE -std=c++17 -fPIC)

# 主 native 库
add_library(mikuplay_encoder SHARED
    src/JNIOnLoad.cpp
    src/JNIBridge.cpp
    src/CrashHandler.cpp
    src/SignatureVerifier.cpp
    src/ResourceVerifier.cpp
    src/AnnouncementManager.cpp
    src/FeedbackResource.cpp
    src/cdp/CdpProxy.cpp
    src/cdp/CdpBridge.cpp
)

# FeedbackResource.cpp 依赖构建时生成的嵌入头文件
add_dependencies(mikuplay_encoder generate_qrcode_header)

target_include_directories(mikuplay_encoder PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/src/cdp
    ${CMAKE_CURRENT_BINARY_DIR}  # 构建时生成的嵌入头文件（qrcode_embedded.h）
    ${UWEBSOCKETS_SRC_DIR}
    ${USOCKETS_SRC_DIR}
    ${CURL_DIR}/include
    ${PICOSHA256_INCLUDE_DIR}
    ${LIBVPX_PREBUILT_DIR}/include
)

target_link_libraries(mikuplay_encoder
    uSockets
    android
    mediandk  # 包含 AMediaExtractor / AMediaCodec / AMediaFormat
    log
    z
    jnigraphics
    dl       # dladdr — 栈回溯中解析动态符号名
    # libcurl 静态库 + mbedTLS SSL 后端（由 add_subdirectory 生成）
    libcurl_static
    mbedcrypto
    mbedx509
    mbedtls
    # VP9 软件编码 + WebM muxer（透明视频后合成）
    vpx_static
    webm_muxer
)

# ============================================================
#  编译选项 — 多层混淆与加固
# ============================================================

# 手动开启 LTO（不使用 CMake 的 IPO 机制，避免触发 -fuse-ld=gold）
#target_compile_options(mikuplay_encoder PRIVATE -flto=thin)
#target_link_options(mikuplay_encoder PRIVATE -flto=thin -fuse-ld=lld)

target_compile_options(mikuplay_encoder PRIVATE
    # ── 基础优化（已有） ──
    -O3
    -fvisibility=hidden
    -fno-rtti
    -fomit-frame-pointer

    # ── 崩溃/错误捕获：强制生成 eh_frame unwind 表
    #  与 -fomit-frame-pointer 并存：_Unwind_Backtrace 基于 DWARF 表而非帧指针回溯，
    #  对 dladdr 无法解析到符号名的 hidden-visibility 函数，配合自定义"函数名注册表"
    #  由 JNI 边界 / 关键函数入口宏注册，运行时按地址二分查表得函数名。
    -funwind-tables

    # ── 新增混淆加固 ──

    # 禁用异常，去除异常处理表（eh_frame），减小分析面
    #-fno-exceptions

    # 强制内联，减少函数数量，扰乱反汇编视图
    -finline-functions

    # 禁止内置函数实现，使 memcpy / memset 等以 call 形式出现而非内联指令
    # 防止逆向者通过特征指令序列识别标准函数
    -fno-builtin

    # 函数级分段，配合 --gc-sections 剔除无用代码
    -ffunction-sections
    -fdata-sections

    # 增强栈保护（插入 canary，增加利用难度）
    -fstack-protector-strong

    # 将全局变量放在 .data.rel.ro 而非 .data 段
    # 配合 -Wl,-z,relro 使重定位表在加载后变为只读
    -fPIC

    # 对齐所有函数入口，使反汇编器难以判断边界
    -falign-functions=16
)

# LTO 仅在 arm64-v8a 启用，armeabi-v7a 的 thread_local + ThinLTO 有 TLS 链接问题
if(CMAKE_SYSTEM_PROCESSOR STREQUAL "aarch64" OR ANDROID_ABI STREQUAL "arm64-v8a")
    target_compile_options(mikuplay_encoder PRIVATE -flto=thin)
    target_link_options(mikuplay_encoder PRIVATE -flto=thin)
endif()

# ============================================================
#  链接选项 — strip & 内存保护
# ============================================================
target_link_options(mikuplay_encoder PRIVATE
    # ── 已有的 ──
    -Wl,--exclude-libs,ALL
    -Wl,-s
    -Wl,-z,max-page-size=16384
    -Wl,-z,common-page-size=16384

    # ── 新增 ──

    # 立即绑定 + 只读重定位
    # 禁止 .got.plt 懒加载，加载完毕即标记 RELRO 为只读
    #-Wl,-z,now
    #-Wl,-z,relro

    # ★ 崩溃符号名解析：把所有全局符号（JNI 导出 + default-visibility）加入动态符号表
    #   (-fvisibility=hidden 下仍可看到 extern "C" 的 JNI 导出函数和系统库符号)
    #   使 dladdr 能解析这些函数名；hidden 函数则通过 CrashHandler 的
    #   自定义"函数名注册表"按地址范围做回退解析。
    -rdynamic

    # 丢弃所有调试信息 / 注释段 / 局部符号
    -Wl,--strip-all
    -Wl,--discard-all

    # 删除未引用 section（配合 -ffunction-sections / -fdata-sections）
    -Wl,--gc-sections

    # 未定义符号在链接时报错而非运行时崩溃
    -Wl,--no-undefined

    # 删除 .eh_frame / .eh_frame_hdr（无 C++ 异常时无需保留）
    # 去除后 crash 堆栈将不包含函数名，加大分析难度
    # ★ 现在用 _Unwind_Backtrace 做栈回溯，依赖 .eh_frame，故保留
    #-Wl,--no-eh-frame-hdr
)
