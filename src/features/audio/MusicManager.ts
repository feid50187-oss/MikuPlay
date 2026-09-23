
/**
 * MusicManager - 音乐管理器
 * 
 * 主要功能:
 * - 管理音频文件的导入、播放、暂停、停止等操作
 * - 维护音乐列表和当前播放状态
 * - 提供与动画同步的功能
 * - 通过 Web Worker 获取音频时长，避免阻塞主线程
 * 
 * 调用关系:
 * - 被 UI 层调用: 音乐面板通过此管理器控制音乐播放
 * - 调用 videoComposeManager: 设置/清除视频合成的背景音乐
 * - 调用 eventBus: 发布音乐状态变化事件
 * - 调用 musicWorker: 在 Worker 线程中获取音频时长
 * 
 * 单例模式: 使用 getInstance() 获取唯一实例
 */

import { Capacitor } from '@capacitor/core';
import { videoComposeManager } from '../videoCompose';
import { eventBus } from '../../core';
import { Events } from '../../core';

/** 音乐信息接口 */
export interface MusicInfo {
    id: string;
    name: string;
    filePath: string;
    duration: number;
    currentTime: number;
}

/** 音乐播放状态 */
export type MusicPlaybackState = 'playing' | 'paused' | 'stopped' | 'loading';

/**
 * 音乐管理器类
 * 负责所有音乐相关的操作和状态管理
 */
export class MusicManager {
    private static instance: MusicManager | null = null;
    private audioElement: HTMLAudioElement | null = null;
    private currentMusic: MusicInfo | null = null;
    private musicList: MusicInfo[] = [];
    
    private playbackState: MusicPlaybackState = 'stopped';
    private _persistentWorker: Worker | null = null;

    private constructor() {
        this.initializeAudio();
    }

    /**
     * 获取 MusicManager 单例实例
     * @returns MusicManager 实例
     */
    public static getInstance(): MusicManager {
        if (!MusicManager.instance) {
            MusicManager.instance = new MusicManager();
        }
        return MusicManager.instance;
    }

    /**
     * 重置单例实例（用于测试或重新初始化）
     */
    public static resetInstance(): void {
        if (MusicManager.instance) {
            MusicManager.instance.dispose();
        }
        MusicManager.instance = undefined as any;
    }

    /**
     * 初始化音频元素和事件监听
     * 设置元数据加载、时间更新、播放结束等事件处理
     */
    private initializeAudio(): void {
        this.audioElement = new Audio();
        this.audioElement.preload = 'metadata';
        
        // 元数据加载完成时更新音乐时长
        this.audioElement.addEventListener('loadedmetadata', () => {
            if (this.currentMusic) {
                this.currentMusic.duration = this.audioElement!.duration;
                this.notifyMusicChange();
            }
        });

        // 播放时间更新时同步当前时间
        this.audioElement.addEventListener('timeupdate', () => {
            if (this.audioElement && this.currentMusic) {
                this.currentMusic.currentTime = this.audioElement.currentTime;
                this.notifyTimeUpdate();
            }
        });

        // 播放结束时重置状态
        this.audioElement.addEventListener('ended', () => {
            this.playbackState = 'stopped';
            this.notifyStateChange();
            if (this.currentMusic) {
                this.currentMusic.currentTime = 0;
            }
        });

        // 播放错误处理
        this.audioElement.addEventListener('error', (e) => {
            console.error('音频播放错误:', e);
            this.playbackState = 'stopped';
            this.notifyStateChange();
        });
    }

    //region Music Import

    /**
     * 导入音乐文件
     * @param filePath - 文件路径
     * @param fileName - 文件名
     * @returns 导入的音乐信息
     */
    public async importMusic(filePath: string, fileName: string): Promise<MusicInfo> {
        const musicId = this.generateMusicId();
        const fileUrl = Capacitor.convertFileSrc(filePath);
        
        const duration = await this.getAudioDurationInWorker(fileUrl);
        
        const musicInfo: MusicInfo = {
            id: musicId,
            name: fileName,
            filePath,
            duration,
            currentTime: 0
        };

        this.musicList.push(musicInfo);
        eventBus.emit(Events.MUSIC_LOADED, musicInfo);
        this.notifyMusicListChange();
        
        videoComposeManager.setMusic(filePath, fileName);
        
        return musicInfo;
    }

    /**
     * 获取或创建 Worker 实例
     * 复用已有的 Worker 实例，避免频繁创建和销毁
     * @returns Worker 实例
     */
    private getOrCreateWorker(): Worker {
        if (!this._persistentWorker) {
            this._persistentWorker = new Worker(
                new URL('./musicWorker.ts', import.meta.url),
                { type: 'module' }
            );
        }
        return this._persistentWorker;
    }

    /**
     * 在 Web Worker 中获取音频时长
     * 避免在主线程中处理大文件导致 UI 卡顿
     * @param fileUrl - 音频文件 URL
     * @returns 音频时长（秒）
     */
    private async getAudioDurationInWorker(fileUrl: string): Promise<number> {
        return new Promise((resolve) => {
            const worker = this.getOrCreateWorker();

            worker.postMessage({ type: 'GET_DURATION', fileUrl });

            const timeoutId = setTimeout(() => {
                resolve(0);
            }, 10000);

            const messageHandler = (e: MessageEvent) => {
                clearTimeout(timeoutId);
                worker.removeEventListener('message', messageHandler);
                worker.removeEventListener('error', errorHandler);
                if (e.data.success) {
                    resolve(e.data.duration);
                } else {
                    resolve(0);
                }
            };

            const errorHandler = () => {
                clearTimeout(timeoutId);
                worker.removeEventListener('message', messageHandler);
                worker.removeEventListener('error', errorHandler);
                resolve(0);
            };

            worker.addEventListener('message', messageHandler);
            worker.addEventListener('error', errorHandler);
        });
    }

    //endregion

    //region Music Deletion

    /**
     * 删除指定音乐
     * @param musicId - 音乐 ID
     * @returns 是否删除成功
     */
    public deleteMusic(musicId: string): boolean {
        const index = this.musicList.findIndex(m => m.id === musicId);
        if (index === -1) return false;

        const music = this.musicList[index];
        
        // 如果删除的是当前播放的音乐，先停止播放
        if (this.currentMusic?.id === musicId) {
            this.stop();
            this.currentMusic = null;
            this.audioElement!.src = '';
            this.notifyMusicChange();
        }

        this.musicList.splice(index, 1);
        eventBus.emit(Events.MUSIC_REMOVED, { musicId });

        this.releaseMusicMemory(music);
        
        // 如果没有音乐了，清除视频合成的音乐设置
        if (this.musicList.length === 0) {
            videoComposeManager.clearMusic();
        }
        
        this.notifyMusicListChange();
        return true;
    }

    /**
     * 释放音乐占用的内存
     * @param music - 音乐信息对象
     */
    private releaseMusicMemory(music: MusicInfo): void {
        music.currentTime = 0;
        music.duration = 0;
    }

    /**
     * 清除所有音乐
     */
    public clearAllMusic(): void {
        this.stop();
        this.currentMusic = null;
        if (this.audioElement) {
            this.audioElement.src = '';
        }
        
        this.musicList.forEach(music => {
            this.releaseMusicMemory(music);
        });
        
        this.musicList = [];
        this.notifyMusicChange();
        this.notifyMusicListChange();
        
        videoComposeManager.clearMusic();
    }

    //endregion

    //region Playback Control

    /**
     * 加载指定音乐
     * @param musicId - 音乐 ID
     * @returns 是否加载成功
     */
    public async loadMusic(musicId: string): Promise<boolean> {
        const music = this.musicList.find(m => m.id === musicId);
        if (!music) return false;

        this.currentMusic = music;
        const fileUrl = Capacitor.convertFileSrc(music.filePath);
        
        if (this.audioElement) {
            this.audioElement.src = fileUrl;
            this.audioElement.load();
        }
        
        this.notifyMusicChange();
        return true;
    }

    /**
     * 播放当前音乐
     */
    public async play(): Promise<void> {
        if (!this.audioElement || !this.currentMusic) return;

        try {
            this.playbackState = 'playing';
            await this.audioElement.play();
            this.notifyStateChange();
        } catch (error) {
            console.error('播放音乐失败:', error);
            this.playbackState = 'stopped';
            this.notifyStateChange();
        }
    }

    /**
     * 暂停播放
     */
    public pause(): void {
        if (!this.audioElement) return;

        this.audioElement.pause();
        this.playbackState = 'paused';
        this.notifyStateChange();
    }

    /**
     * 停止播放并重置时间
     */
    public stop(): void {
        if (!this.audioElement) return;

        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        this.playbackState = 'stopped';
        
        if (this.currentMusic) {
            this.currentMusic.currentTime = 0;
        }
        
        this.notifyStateChange();
    }

    /**
     * 跳转到指定时间
     * @param time - 目标时间（秒）
     */
    public seek(time: number): void {
        if (!this.audioElement || !this.currentMusic) return;

        const clampedTime = Math.max(0, Math.min(time, this.currentMusic.duration));
        this.audioElement.currentTime = clampedTime;
        this.currentMusic.currentTime = clampedTime;
        this.notifyTimeUpdate();
    }

    /**
     * 设置音量
     * @param volume - 音量值（0-1）
     */
    public setVolume(volume: number): void {
        if (!this.audioElement) return;
        this.audioElement.volume = Math.max(0, Math.min(1, volume));
    }

    //endregion

    //region Sync with Animation

    /**
     * 与动画时间同步
     * 当时间差超过 0.1 秒时进行调整
     * @param animationTime - 动画当前时间
     */
    public async syncWithAnimation(animationTime: number): Promise<void> {
        if (!this.audioElement || !this.currentMusic) return;
        
        const timeDiff = Math.abs(this.audioElement.currentTime - animationTime);
        if (timeDiff > 0.1) {
            this.audioElement.currentTime = animationTime;
        }
    }

    //endregion

    //region Getters

    /**
     * 获取当前播放的音乐信息
     */
    public getCurrentMusic(): MusicInfo | null {
        return this.currentMusic;
    }

    /**
     * 获取音乐列表
     */
    public getMusicList(): ReadonlyArray<MusicInfo> {
        return this.musicList;
    }

    /**
     * 获取当前播放状态
     */
    public getPlaybackState(): MusicPlaybackState {
        return this.playbackState;
    }

    /**
     * 检查是否正在播放
     */
    public isPlaying(): boolean {
        return this.playbackState === 'playing';
    }

    //endregion

    //region EventBus Notifications

    /** 通知状态变化 */
    private notifyStateChange(): void {
        eventBus.emit(Events.MUSIC_STATE_CHANGED, this.playbackState);
    }

    /** 通知时间更新 */
    private notifyTimeUpdate(): void {
        if (!this.currentMusic) return;
        eventBus.emit(Events.MUSIC_TIME_UPDATED, {
            currentTime: this.currentMusic.currentTime,
            duration: this.currentMusic.duration
        });
    }

    /** 通知当前音乐变化 */
    private notifyMusicChange(): void {
        eventBus.emit(Events.MUSIC_CHANGED, this.currentMusic);
    }

    /** 通知音乐列表变化 */
    private notifyMusicListChange(): void {
        eventBus.emit(Events.MUSIC_LIST_CHANGED, this.musicList);
    }

    //endregion

    //region Utility

    /**
     * 生成唯一的音乐 ID
     */
    private generateMusicId(): string {
        return `music_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * 释放资源并清理
     */
    public dispose(): void {
        this.stop();
        
        if (this.audioElement) {
            this.audioElement.src = '';
            this.audioElement = null;
        }
        
        if (this._persistentWorker) {
            this._persistentWorker.terminate();
            this._persistentWorker = null;
        }
        
        this.clearAllMusic();
        
        MusicManager.instance = null;
    }

    //endregion
}
