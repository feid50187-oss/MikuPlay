#include "ResourceVerifier.h"
#include "Integrity.h"
#include <cstring>
#include <cstdint>

// ============================================================================
// 预期资源 SHA-256 指纹（XOR 混淆存储）
// 对 assets/public/js/ 下所有 .js 文件按文件名排序后拼接的 SHA-256
// 构建后需更新此处的期望值（见文件末尾说明）
// ============================================================================

namespace {

// 期望哈希的密钥以逐字节混淆形式独立存放（KEY_MIXED），与密文段(PART)分离，
// 避免"相邻结构体整体 dump 后逐段异或"即可还原的静态弱点。
// keyByte[j] = KEY_MIXED[j] ^ (0xA7 + (j & 0x0F))
// 由 scripts/generate-resource-hash.js 生成 — 每次 npm run build 后需更新
    static const uint8_t KEY_MIXED[32] = {
            0x48, 0xAE, 0x33, 0x84, 0x48, 0xE9, 0xFA, 0x96,
            0xD5, 0x9F, 0xAB, 0x21, 0xF0, 0xB4, 0xE4, 0x00,
            0xC3, 0x3F, 0xA3, 0xD1, 0xF6, 0x16, 0x29, 0x41,
            0x52, 0xF4, 0x82, 0xD7, 0x79, 0x5D, 0x54, 0x45,
    };

    static const uint64_t PART[4] = {
            0x18F90D1D0CB1311AULL,
            0xC6261993ECC7D654ULL,
            0x86B6EE561D51566ULL,
            0x7716F70506D9B807ULL,
    };

// ============================================================================
// SHA-256 实现（RFC 6234，无外部依赖）
// 与 SignatureVerifier.cpp 共享相同的实现
// ============================================================================

struct Sha256Ctx {
    uint32_t state[8];
    uint64_t count;
    uint8_t  buf[64];
};

// 反 FindCrypt：常量表以异或掩码形式存放、运行期还原，静态扫描无法匹配标准 SHA-256 表
static const uint32_t SHA256_K[64] = {
    0xE72F8A3D,0xD492E134,0x10655E6A,0x4C107E00,
    0x9CF367FE,0xFC54B454,0x379A2701,0x0EB9FB70,
    0x7DA20F3D,0xB726FEA4,0x8194201B,0xF0A9D866,
    0xD71BF8D1,0x257B145B,0x3E79A302,0x643E54D1,
    0x413ECC64,0x4A1BE223,0xAA643863,0x81A90469,
    0x884C89CA,0xEFD1210F,0xF9150C79,0xD35C2D7F,
    0x3D9BF4F7,0x0D9463C8,0x15A6826D,0x1AFCDA62,
    0x6345AE56,0x700234E2,0xA36FC6F4,0xB18C8CC2,
    0x8212AF20,0x8BBE849D,0xE889C859,0xF69DA8B6,
    0xC0AFD6F1,0xD3CFAF1E,0x24676C8B,0x37D78920,
    0x071A4D04,0x0DBFC3EE,0x67EE2ED5,0x62C9F406,
    0x74374DBC,0x733CA381,0x51AB9020,0xB5CF05D5,
    0xBC0164B3,0xBB92C9AD,0x82EDD2E9,0x91151910,
    0x9CB9A916,0xEB7D0FEF,0xFE396FEA,0xCD8BCA56,
    0xD12A274B,0xDD00C6CA,0x216DDDB1,0x2962A7AD,
    0x351B5A5F,0x01F5C94E,0x1B5C0652,0x63D4DD57,
};

static inline uint32_t rotr32(uint32_t x, uint32_t n) {
    return (x >> n) | (x << (32 - n));
}

#define SHA256_CH(x,y,z)  (((x) & (y)) ^ (~(x) & (z)))
#define SHA256_MAJ(x,y,z) (((x) & (y)) ^ ((x) & (z)) ^ ((y) & (z)))
#define SHA256_BSIG0(x)   (rotr32(x, 2) ^ rotr32(x,13) ^ rotr32(x,22))
#define SHA256_BSIG1(x)   (rotr32(x, 6) ^ rotr32(x,11) ^ rotr32(x,25))
#define SHA256_SSIG0(x)   (rotr32(x, 7) ^ rotr32(x,18) ^ (x >> 3))
#define SHA256_SSIG1(x)   (rotr32(x,17) ^ rotr32(x,19) ^ (x >> 10))

static void sha256Transform(Sha256Ctx* ctx, const uint8_t* data) {
    uint32_t a, b, c, d, e, f, g, h;
    uint32_t w[64];

    for (int i = 0; i < 16; ++i) {
        w[i] = ((uint32_t)data[i*4] << 24) |
               ((uint32_t)data[i*4+1] << 16) |
               ((uint32_t)data[i*4+2] << 8) |
               ((uint32_t)data[i*4+3]);
    }
    for (int i = 16; i < 64; ++i) {
        w[i] = SHA256_SSIG1(w[i-2]) + w[i-7] + SHA256_SSIG0(w[i-15]) + w[i-16];
    }

    a = ctx->state[0]; b = ctx->state[1];
    c = ctx->state[2]; d = ctx->state[3];
    e = ctx->state[4]; f = ctx->state[5];
    g = ctx->state[6]; h = ctx->state[7];

    for (int i = 0; i < 64; ++i) {
        uint32_t t1 = h + SHA256_BSIG1(e) + SHA256_CH(e,f,g) + (SHA256_K[i] ^ 0xA5A5A5A5u) + w[i];
        uint32_t t2 = SHA256_BSIG0(a) + SHA256_MAJ(a,b,c);
        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }

    ctx->state[0] += a; ctx->state[1] += b;
    ctx->state[2] += c; ctx->state[3] += d;
    ctx->state[4] += e; ctx->state[5] += f;
    ctx->state[6] += g; ctx->state[7] += h;
}

static void sha256Init(Sha256Ctx* ctx) {
    ctx->state[0] = 0x3053BC3Du ^ 0x5A5A5A5Au;
    ctx->state[1] = 0xE13DF4DFu ^ 0x5A5A5A5Au;
    ctx->state[2] = 0x6634A928u ^ 0x5A5A5A5Au;
    ctx->state[3] = 0xFF15AF60u ^ 0x5A5A5A5Au;
    ctx->state[4] = 0x0B540825u ^ 0x5A5A5A5Au;
    ctx->state[5] = 0xC15F32D6u ^ 0x5A5A5A5Au;
    ctx->state[6] = 0x45D983F1u ^ 0x5A5A5A5Au;
    ctx->state[7] = 0x01BA9743u ^ 0x5A5A5A5Au;
    ctx->count = 0;
}

static void sha256Update(Sha256Ctx* ctx, const uint8_t* data, size_t len) {
    size_t i = (size_t)(ctx->count & 63);
    ctx->count += (uint64_t)len;

    if (i > 0) {
        size_t avail = 64 - i;
        if (len < avail) {
            memcpy(ctx->buf + i, data, len);
            return;
        }
        memcpy(ctx->buf + i, data, avail);
        sha256Transform(ctx, ctx->buf);
        data += avail;
        len  -= avail;
    }

    while (len >= 64) {
        sha256Transform(ctx, data);
        data += 64;
        len  -= 64;
    }

    if (len > 0) {
        memcpy(ctx->buf, data, len);
    }
}

static void sha256Final(Sha256Ctx* ctx, uint8_t* digest) {
    uint64_t bits = ctx->count * 8;
    size_t   i    = (size_t)(ctx->count & 63);
    ctx->buf[i++] = 0x80;

    if (i > 56) {
        memset(ctx->buf + i, 0, 64 - i);
        sha256Transform(ctx, ctx->buf);
        i = 0;
    }
    memset(ctx->buf + i, 0, 56 - i);

    for (int j = 0; j < 8; ++j) {
        ctx->buf[56 + j] = (uint8_t)(bits >> (56 - j * 8));
    }
    sha256Transform(ctx, ctx->buf);

    for (int j = 0; j < 8; ++j) {
        digest[j*4]     = (uint8_t)(ctx->state[j] >> 24);
        digest[j*4 + 1] = (uint8_t)(ctx->state[j] >> 16);
        digest[j*4 + 2] = (uint8_t)(ctx->state[j] >>  8);
        digest[j*4 + 3] = (uint8_t)(ctx->state[j]);
    }
}

// ============================================================================
// 常量时间内存比较（防止时序攻击推断正确哈希值）
// ============================================================================
static bool constantTimeEqual(const uint8_t* a, const uint8_t* b, size_t len) {
    uint8_t diff = 0;
    for (size_t i = 0; i < len; ++i) {
        diff |= a[i] ^ b[i];
    }
    return diff == 0;
}

} // namespace

// ============================================================================
// 公开入口 — 单次校验：对整个拼接数据计算 SHA-256 并与预置指纹比对
// ============================================================================

jboolean resourceVerify(JNIEnv* env, jbyteArray data, jboolean enforce) {
    if (!data) {
        return JNI_FALSE;
    }

    jsize len = env->GetArrayLength(data);
    if (len <= 0) {
        return JNI_FALSE;
    }

    jbyte* bytes = env->GetByteArrayElements(data, nullptr);
    if (!bytes) {
        return JNI_FALSE;
    }

    Sha256Ctx ctx;
    sha256Init(&ctx);
    sha256Update(&ctx, reinterpret_cast<const uint8_t*>(bytes), len);
    env->ReleaseByteArrayElements(data, bytes, JNI_ABORT);

    uint8_t digest[32];
    sha256Final(&ctx, digest);

    // 解密预期哈希并常量时间比对（密钥与密文分离存放）
    uint8_t keyBuf[32];
    for (int j = 0; j < 32; ++j) {
        keyBuf[j] = static_cast<uint8_t>(KEY_MIXED[j] ^ (0xA7u + (j & 0x0F)));
    }
    uint8_t expected[32];
    for (int i = 0; i < 4; ++i) {
        uint64_t k;
        memcpy(&k, keyBuf + i * 8, 8);
        uint64_t decrypted = PART[i] ^ k;
        memcpy(expected + i * 8, &decrypted, 8);
    }

    bool ok = constantTimeEqual(digest, expected, 32);
    if (ok) {
        integrity::markVerified(integrity::RES_BIT);
        return JNI_TRUE;
    }
    if (enforce) {
        // release：随机延迟静默崩溃，崩溃点远离校验点
        //integrity::scheduleDelayedCrash();
        integrity::markVerified(integrity::SIG_BIT);
    } else {
        // debug：不阻断（开发期资源频繁变动），仅记录通过态
        integrity::markVerified(integrity::RES_BIT);
        //integrity::scheduleDelayedCrash();//正式发布避免被patch为debuggable
    }
    return JNI_FALSE;
}
