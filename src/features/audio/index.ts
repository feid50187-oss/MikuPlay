
/**
 * Audio 模块入口
 * 
 * 导出内容:
 * - MusicManager: 音乐管理器类，负责音乐播放控制
 * - MusicInfo: 音乐信息接口
 * - MusicPlaybackState: 音乐播放状态类型
 * 
 * 使用示例:
 * ```typescript
 * import { MusicManager } from './features/audio';
 * 
 * const musicManager = MusicManager.getInstance();
 * await musicManager.importMusic('/path/to/music.mp3', 'music.mp3');
 * await musicManager.play();
 * ```
 */

export { MusicManager } from './MusicManager';
export type { MusicInfo, MusicPlaybackState } from './MusicManager';
