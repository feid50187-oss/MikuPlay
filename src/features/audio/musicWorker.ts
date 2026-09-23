
/**
 * Music Worker - 音频处理 Web Worker
 * 
 * 主要功能:
 * - 在后台线程中处理音频相关的计算密集型任务
 * - 获取音频文件时长，避免阻塞主线程 UI
 * - 解码音频数据（预留功能）
 * 
 * 调用关系:
 * - 被 MusicManager 调用: 通过 Worker 构造函数创建实例并发送消息
 * - 与主线程通信: 使用 postMessage/onmessage 进行数据交换
 * 
 * 消息类型:
 * - GET_DURATION: 获取音频时长
 * - DECODE_AUDIO: 解码音频数据（预留）
 */

/** Worker 接收的消息类型 */
interface WorkerMessage {
    type: 'GET_DURATION' | 'DECODE_AUDIO';
    fileUrl: string;
    audioData?: ArrayBuffer;
}

/** Worker 发送的响应类型 */
interface WorkerResponse {
    type: string;
    success: boolean;
    duration?: number;
    error?: string;
    audioBuffer?: AudioBuffer;
}

/**
 * 处理来自主线程的消息
 * 根据消息类型分发到对应的处理函数
 */
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { type, fileUrl, audioData } = e.data;

    try {
        switch (type) {
            case 'GET_DURATION':
                await handleGetDuration(fileUrl);
                break;
            case 'DECODE_AUDIO':
                if (audioData) {
                    await handleDecodeAudio(audioData);
                } else {
                    sendError(type, 'No audio data provided');
                }
                break;
            default:
                sendError(type, `Unknown message type: ${type}`);
        }
    } catch (error) {
        sendError(type, error instanceof Error ? error.message : 'Unknown error');
    }
};

/**
 * 获取音频文件时长
 * 使用 fetch 获取文件，尝试用 AudioContext 解码获取准确时长
 * 如果解码失败，使用文件大小估算时长作为后备方案
 * 
 * @param fileUrl - 音频文件 URL
 */
async function handleGetDuration(fileUrl: string): Promise<void> {
    try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        
        let duration = 0;
        
        try {
            // 尝试使用 AudioContext 解码获取准确时长
            // @ts-ignore - AudioContext 在某些 Worker 环境中可能不可用
            const audioContext = new (self.AudioContext || self.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            duration = audioBuffer.duration;
            await audioContext.close();
        } catch {
            // 后备方案：根据文件大小估算时长
            // 假设平均比特率为 128 kbps
            const bytesPerSecond = 16000;
            duration = arrayBuffer.byteLength / bytesPerSecond;
        }

        const response_msg: WorkerResponse = {
            type: 'GET_DURATION',
            success: true,
            duration
        };
        self.postMessage(response_msg);
    } catch (error) {
        sendError('GET_DURATION', error instanceof Error ? error.message : 'Failed to get duration');
    }
}

/**
 * 解码音频数据（预留功能）
 * 将 ArrayBuffer 解码为 AudioBuffer，并提取通道数据
 * 
 * @param audioData - 音频二进制数据
 */
async function handleDecodeAudio(audioData: ArrayBuffer): Promise<void> {
    try {
        // @ts-ignore
        const audioContext = new (self.AudioContext || self.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));
        
        // 提取各通道数据
        const channels: Float32Array[] = [];
        for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
            channels.push(audioBuffer.getChannelData(i));
        }

        const response: WorkerResponse = {
            type: 'DECODE_AUDIO',
            success: true,
            duration: audioBuffer.duration,
        };
        
        // 使用 Transferable 对象传输数据，避免复制
        const transferables = channels.map(c => c.buffer);
        (self.postMessage as (message: any, transfer?: Transferable[]) => void)(response, transferables);
        await audioContext.close();
    } catch (error) {
        sendError('DECODE_AUDIO', error instanceof Error ? error.message : 'Failed to decode audio');
    }
}

/**
 * 发送错误响应
 * @param type - 消息类型
 * @param errorMessage - 错误信息
 */
function sendError(type: string, errorMessage: string): void {
    const response: WorkerResponse = {
        type,
        success: false,
        error: errorMessage
    };
    self.postMessage(response);
}

// 导出空对象使此文件成为模块
export {};
