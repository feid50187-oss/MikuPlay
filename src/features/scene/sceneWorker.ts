
import type { WorkerMessage, WorkerResponse } from './types';

/**
 * 场景计算 Worker
 * 用于处理计算密集型任务，避免阻塞主线程
 */

/**
 * 处理初始化消息
 */
function handleInit(): WorkerResponse {
    return {
        type: 'init',
        success: true,
        data: { initialized: true }
    };
}

/**
 * 计算格网点数据
 * @param size 格网大小
 * @param spacing 格网间距
 */
function calculateGridPoints(size: number, spacing: number): WorkerResponse {
    const points: Array<{ x: number; y: number; z: number }> = [];
    const halfSize = size / 2;

    for (let i = -halfSize; i <= halfSize; i += spacing) {
        for (let j = -halfSize; j <= halfSize; j += spacing) {
            points.push({ x: i, y: 0, z: j });
        }
    }

    return {
        type: 'calculateGrid',
        success: true,
        data: { points, count: points.length }
    };
}

/**
 * 计算光照变换矩阵
 * @param angleX X轴旋转角度
 * @param angleY Y轴旋转角度
 * @param angleZ Z轴旋转角度
 */
function calculateLightTransform(angleX: number, angleY: number, angleZ: number): WorkerResponse {
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const cosZ = Math.cos(angleZ);
    const sinZ = Math.sin(angleZ);

    const rotationMatrix = [
        [
            cosY * cosZ,
            -cosY * sinZ,
            sinY
        ],
        [
            sinX * sinY * cosZ + cosX * sinZ,
            -sinX * sinY * sinZ + cosX * cosZ,
            -sinX * cosY
        ],
        [
            -cosX * sinY * cosZ + sinX * sinZ,
            cosX * sinY * sinZ + sinX * cosZ,
            cosX * cosY
        ]
    ];

    return {
        type: 'calculateLightTransform',
        success: true,
        data: { rotationMatrix }
    };
}

/**
 * 消息处理函数
 */
function handleMessage(message: WorkerMessage): WorkerResponse {
    try {
        switch (message.type) {
            case 'init':
                return handleInit();

            case 'calculateGrid':
                return calculateGridPoints(
                    message.payload?.size ?? 10,
                    message.payload?.spacing ?? 1
                );

            case 'calculateLightTransform':
                return calculateLightTransform(
                    message.payload?.angleX ?? 0,
                    message.payload?.angleY ?? 0,
                    message.payload?.angleZ ?? 0
                );

            default:
                return {
                    type: message.type,
                    success: false,
                    error: `Unknown message type: ${(message as any).type}`
                };
        }
    } catch (error) {
        return {
            type: message.type,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

self.onmessage = function(event: MessageEvent<WorkerMessage>) {
    const response = handleMessage(event.data);
    self.postMessage(response);
};

export {};
