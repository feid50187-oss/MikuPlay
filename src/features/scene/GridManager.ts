
import {
    Scene,
    MeshBuilder,
    StandardMaterial,
    Color3,
    Vector3,
    LinesMesh
} from '@babylonjs/core';
import type { IGridManager } from './types';

/**
 * 坐标格网管理器
 * 实现XYZ坐标轴正轴使用RGB颜色区分于其他轴线的坐标格网
 */
export class GridManager implements IGridManager {
    /** Babylon 场景实例 */
    private scene: Scene;

    /** 坐标格网可见性 */
    private visible: boolean = true;

    /** 坐标轴线网格 */
    private gridLines: LinesMesh[] = [];

    /** 格网大小 */
    private readonly gridSize: number = 100;

    /** 格网间距 */
    private readonly gridSpacing: number = 10;

    /** 轴线颜色配置 */
    private readonly axisColors = {
        positiveX: new Color3(1, 0, 0),
        positiveY: new Color3(0, 1, 0),
        positiveZ: new Color3(0, 0, 1),
        grid: new Color3(0.5, 0.5, 0.5)
    };

    /**
     * 构造函数
     * @param scene Babylon 场景实例
     */
    constructor(scene: Scene) {
        this.scene = scene;
        this.createGrid();
    }

    /**
     * 创建坐标格网
     */
    private createGrid(): void {
        this.createGridLines();
    }

    /**
     * 创建格网线（使用 LineSystem 合并同色线条，减少 draw call）
     */
    private createGridLines(): void {
        const halfSize = this.gridSize / 2;

        // 按颜色分组收集线条点
        const gridPoints: Vector3[][] = [];
        const axisPointsX: Vector3[][] = [];
        const axisPointsY: Vector3[][] = [];
        const axisPointsZ: Vector3[][] = [];

        for (let i = -halfSize; i <= halfSize; i++) {
            if (i === 0) continue;

            const isEdge = Math.abs(i) === halfSize;

            // X方向线
            gridPoints.push([
                new Vector3(i, 0, -halfSize),
                new Vector3(i, 0, halfSize)
            ]);

            // Z方向线
            gridPoints.push([
                new Vector3(-halfSize, 0, i),
                new Vector3(halfSize, 0, i)
            ]);
        }

        // 坐标轴线
        axisPointsX.push([Vector3.Zero(), new Vector3(halfSize, 0, 0)]);      // 正X
        axisPointsX.push([Vector3.Zero(), new Vector3(-halfSize, 0, 0)]);      // 负X（用grid色）

        axisPointsY.push([Vector3.Zero(), new Vector3(0, halfSize, 0)]);       // 正Y
        axisPointsY.push([Vector3.Zero(), new Vector3(0, -halfSize, 0)]);      // 负Y

        axisPointsZ.push([Vector3.Zero(), new Vector3(0, 0, halfSize)]);       // 正Z
        axisPointsZ.push([Vector3.Zero(), new Vector3(0, 0, -halfSize)]);      // 负Z

        // 创建合并的 LineSystem（每种颜色一个 draw call）
        if (gridPoints.length > 0) {
            const gridLineSystem = MeshBuilder.CreateLineSystem('gridLines', {
                lines: gridPoints
            }, this.scene);
            const gridMat = new StandardMaterial('gridMat', this.scene);
            gridMat.emissiveColor = this.axisColors.grid;
            gridMat.disableLighting = true;
            gridLineSystem.material = gridMat;
            gridLineSystem.visibility = 0.4;
            this.gridLines.push(gridLineSystem);
        }

        // 正X轴（红色）
        const xLineSystem = MeshBuilder.CreateLineSystem('gridAxisX', {
            lines: [axisPointsX[0]]
        }, this.scene);
        const xMat = new StandardMaterial('gridAxisXMat', this.scene);
        xMat.emissiveColor = this.axisColors.positiveX;
        xMat.disableLighting = true;
        xLineSystem.material = xMat;
        xLineSystem.visibility = 1;
        this.gridLines.push(xLineSystem);

        // 负X轴（灰色）
        const negXLineSystem = MeshBuilder.CreateLineSystem('gridNegAxisX', {
            lines: [axisPointsX[1]]
        }, this.scene);
        negXLineSystem.material = gridPoints.length > 0 ? this.gridLines[0].material! : (() => {
            const m = new StandardMaterial('gridMat2', this.scene);
            m.emissiveColor = this.axisColors.grid;
            m.disableLighting = true;
            return m;
        })();
        negXLineSystem.visibility = 0.4;
        this.gridLines.push(negXLineSystem);

        // 正Y轴（绿色）
        const yLineSystem = MeshBuilder.CreateLineSystem('gridAxisY', {
            lines: [axisPointsY[0]]
        }, this.scene);
        const yMat = new StandardMaterial('gridAxisYMat', this.scene);
        yMat.emissiveColor = this.axisColors.positiveY;
        yMat.disableLighting = true;
        yLineSystem.material = yMat;
        yLineSystem.visibility = 1;
        this.gridLines.push(yLineSystem);

        // 负Y轴
        const negYLineSystem = MeshBuilder.CreateLineSystem('gridNegAxisY', {
            lines: [axisPointsY[1]]
        }, this.scene);
        negYLineSystem.material = gridPoints.length > 0 ? this.gridLines[0].material! : negXLineSystem.material!;
        negYLineSystem.visibility = 0.4;
        this.gridLines.push(negYLineSystem);

        // 正Z轴（蓝色）
        const zLineSystem = MeshBuilder.CreateLineSystem('gridAxisZ', {
            lines: [axisPointsZ[0]]
        }, this.scene);
        const zMat = new StandardMaterial('gridAxisZMat', this.scene);
        zMat.emissiveColor = this.axisColors.positiveZ;
        zMat.disableLighting = true;
        zLineSystem.material = zMat;
        zLineSystem.visibility = 1;
        this.gridLines.push(zLineSystem);

        // 负Z轴
        const negZLineSystem = MeshBuilder.CreateLineSystem('gridNegAxisZ', {
            lines: [axisPointsZ[1]]
        }, this.scene);
        negZLineSystem.material = gridPoints.length > 0 ? this.gridLines[0].material! : negXLineSystem.material!;
        negZLineSystem.visibility = 0.4;
        this.gridLines.push(negZLineSystem);
    }

    /**
     * 创建坐标轴线
     * @param axis 轴类型
     * @param length 轴长度
     */
    private createAxisLine(axis: 'x' | 'y' | 'z', length: number): void {
        let positiveStart: Vector3;
        let positiveEnd: Vector3;
        let negativeStart: Vector3;
        let negativeEnd: Vector3;
        let positiveColor: Color3;

        switch (axis) {
            case 'x':
                positiveStart = Vector3.Zero();
                positiveEnd = new Vector3(length, 0, 0);
                negativeStart = Vector3.Zero();
                negativeEnd = new Vector3(-length, 0, 0);
                positiveColor = this.axisColors.positiveX;
                break;
            case 'y':
                positiveStart = Vector3.Zero();
                positiveEnd = new Vector3(0, length, 0);
                negativeStart = Vector3.Zero();
                negativeEnd = new Vector3(0, -length, 0);
                positiveColor = this.axisColors.positiveY;
                break;
            case 'z':
                positiveStart = Vector3.Zero();
                positiveEnd = new Vector3(0, 0, length);
                negativeStart = Vector3.Zero();
                negativeEnd = new Vector3(0, 0, -length);
                positiveColor = this.axisColors.positiveZ;
                break;
        }

        // 正轴使用彩色
        const positiveLine = this.createLine(positiveStart, positiveEnd, positiveColor);
        positiveLine.visibility = 1;
        this.gridLines.push(positiveLine);

        // 负轴使用普通格网颜色
        const negativeLine = this.createLine(negativeStart, negativeEnd, this.axisColors.grid);
        negativeLine.visibility = 0.4;
        this.gridLines.push(negativeLine);
    }

    /**
     * 创建单条线
     * @param start 起点
     * @param end 终点
     * @param color 颜色
     * @returns 线网格
     */
    private createLine(start: Vector3, end: Vector3, color: Color3): LinesMesh {
        const line = MeshBuilder.CreateLines(
            `gridLine_${this.gridLines.length}`,
            { points: [start, end] },
            this.scene
        );

        const material = new StandardMaterial(
            `gridMaterial_${this.gridLines.length}`,
            this.scene
        );
        material.emissiveColor = color;
        material.disableLighting = true;
        line.material = material;

        return line;
    }

    /**
     * 设置可见性
     * @param visible 是否可见
     */
    public setVisible(visible: boolean): void {
        this.visible = visible;
        this.gridLines.forEach(line => {
            line.setEnabled(visible);
        });
    }

    /**
     * 获取可见性
     * @returns 是否可见
     */
    public getVisible(): boolean {
        return this.visible;
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.gridLines.forEach(line => {
            line.dispose();
        });
        this.gridLines = [];
    }
}
