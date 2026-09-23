
import {
    Scene,
    MeshBuilder,
    StandardMaterial,
    Texture,
    VideoTexture,
    AbstractMesh,
    Vector3,
    Mesh,
    Color3
} from '@babylonjs/core';

export class MediaBackgroundManager {
    private scene: Scene;
    private plane: AbstractMesh | null = null;
    private material: StandardMaterial | null = null;
    private texture: Texture | VideoTexture | null = null;
    private videoElement: HTMLVideoElement | null = null;
    private currentAspectRatio: number = 1;
    // 色调/亮度调整状态：切换媒体后自动恢复
    private _tint: number = 0;       // -1 冷色 ~ 1 暖色，0 = 原样
    private _brightness: number = 1; // 0 ~ 2，1 = 原样

    constructor(scene: Scene) {
        this.scene = scene;
    }

    public setImage(uri: string, width: number, height: number): void {
        this.dispose();

        this.currentAspectRatio = width / height || 1;

        this.texture = new Texture(uri, this.scene, true, true, Texture.NEAREST_SAMPLINGMODE);

        this.material = new StandardMaterial('mediaBackgroundMaterial', this.scene);
        this.material.diffuseTexture = this.texture;
        this.material.emissiveTexture = this.texture;
        this.material.disableLighting = true;

        const planeWidth = 20;
        const planeHeight = planeWidth / this.currentAspectRatio;

        this.plane = MeshBuilder.CreatePlane('mediaBackgroundPlane', {
            width: planeWidth,
            height: planeHeight,
            sideOrientation: Mesh.DOUBLESIDE
        }, this.scene);

        this.plane.material = this.material;
        this.plane.position.set(0, 0, 20);

        this.applyColorAdjust();
    }

    public setVideo(uri: string, width: number, height: number): void {
        this.dispose();

        this.currentAspectRatio = width / height || 1;

        this.videoElement = document.createElement('video');
        this.videoElement.src = uri;
        this.videoElement.muted = true;
        this.videoElement.loop = true;
        this.videoElement.playsInline = true;
        this.videoElement.style.display = 'none';
        document.body.appendChild(this.videoElement);

        this.texture = new VideoTexture(
            'mediaVideoTexture',
            this.videoElement,
            this.scene,
            true,
            false,
            Texture.NEAREST_SAMPLINGMODE
        );

        this.material = new StandardMaterial('mediaBackgroundVideoMaterial', this.scene);
        this.material.diffuseTexture = this.texture;
        this.material.emissiveTexture = this.texture;
        this.material.disableLighting = true;

        const planeWidth = 20;
        const planeHeight = planeWidth / this.currentAspectRatio;

        this.plane = MeshBuilder.CreatePlane('mediaBackgroundVideoPlane', {
            width: planeWidth,
            height: planeHeight,
            sideOrientation: Mesh.DOUBLESIDE
        }, this.scene);

        this.plane.material = this.material;
        this.plane.position.set(0, 0, 20);

        this.applyColorAdjust();
    }

    public dispose(): void {
        if (this.plane) {
            this.plane.dispose();
            this.plane = null;
        }

        if (this.material) {
            this.material.dispose();
            this.material = null;
        }

        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
        }

        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.src = '';
            if (this.videoElement.parentNode) {
                this.videoElement.parentNode.removeChild(this.videoElement);
            }
            this.videoElement = null;
        }

        this.currentAspectRatio = 1;
    }

    public setScale(v: number): void {
        if (this.plane) {
            this.plane.scaling.setAll(v);
        }
    }

    public setPosition(x: number, y: number, z: number): void {
        if (this.plane) {
            this.plane.position.set(x, y, z);
        }
    }

    public setOpacity(v: number): void {
        if (this.material) {
            this.material.alpha = v;
        }
    }

    /**
     * 色调调整（-1 冷色 ~ 1 暖色，0 = 原样）。
     * diffuse/emissive 同步着色：两通道为同一纹理，相乘后效果一致。
     */
    public setTint(v: number): void {
        this._tint = Math.max(-1, Math.min(1, v));
        if (this.material) {
            const c = this.tintColor(this._tint);
            this.material.diffuseColor = c;
            this.material.emissiveColor = c;
        }
    }

    /** 亮度调整（0 ~ 2，1 = 原样）。texture.level 同时作用于 diffuse/emissive 双通道 */
    public setBrightness(v: number): void {
        this._brightness = Math.max(0, Math.min(2, v));
        if (this.texture) {
            this.texture.level = this._brightness;
        }
    }

    /** 切换媒体（重建材质/纹理）后恢复色调与亮度 */
    private applyColorAdjust(): void {
        this.setTint(this._tint);
        this.setBrightness(this._brightness);
    }

    private tintColor(t: number): Color3 {
        if (t >= 0) {
            // 暖色：R 保持，G/B 下降
            return new Color3(1, 1 - t * 0.5, 1 - t * 0.7);
        }
        // 冷色：B 保持，R 下降、G 微降
        const k = -t;
        return new Color3(1 - k * 0.7, 1 - k * 0.15, 1);
    }

    public setBillboard(enabled: boolean): void {
        if (this.plane) {
            this.plane.billboardMode = enabled
                ? AbstractMesh.BILLBOARDMODE_ALL
                : AbstractMesh.BILLBOARDMODE_NONE;
        }
    }

    public play(): void {
        if (this.videoElement && this.videoElement.paused) {
            this.videoElement.play().catch(() => {});
        }
    }

    public pause(): void {
        if (this.videoElement && !this.videoElement.paused) {
            this.videoElement.pause();
        }
    }

    public setLoop(loop: boolean): void {
        if (this.videoElement) {
            this.videoElement.loop = loop;
        }
    }

    public setVolume(v: number): void {
        if (this.videoElement) {
            this.videoElement.volume = Math.max(0, Math.min(1, v));
        }
    }

    public isVideo(): boolean {
        return this.videoElement !== null;
    }

    public getPlane(): AbstractMesh | null {
        return this.plane;
    }
}
