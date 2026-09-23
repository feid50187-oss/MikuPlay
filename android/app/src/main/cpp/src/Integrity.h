#ifndef MIKUPLAY_INTEGRITY_H
#define MIKUPLAY_INTEGRITY_H

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <thread>

namespace integrity {

constexpr uint32_t SIG_BIT = 1u << 0;
constexpr uint32_t RES_BIT = 1u << 1;
constexpr uint32_t ALL_OK  = SIG_BIT | RES_BIT;

inline std::atomic<uint32_t>& state() {
    static std::atomic<uint32_t> s{0};
    return s;
}

inline void markVerified(uint32_t bits) {
    state().fetch_or(bits, std::memory_order_relaxed);
}

inline bool isBlessed() {
    return state().load(std::memory_order_relaxed) == ALL_OK;
}

inline void scheduleDelayedCrash() {
    static std::atomic<bool> scheduled{false};
    bool expected = false;
    if (!scheduled.compare_exchange_strong(expected, true)) {
        return;
    }
    uint64_t now = static_cast<uint64_t>(
            std::chrono::steady_clock::now().time_since_epoch().count());
    uint32_t delayMs = 4000u + static_cast<uint32_t>(now % 21000u);
    std::thread([](uint32_t ms) {
        std::this_thread::sleep_for(std::chrono::milliseconds(ms));
        abort();
    }, delayMs).detach();
}

} // namespace integrity

#endif