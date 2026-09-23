
/**
 * Singleton 统一类型
 * 描述 Singleton 类的静态侧契约：getInstance() + resetInstance()
 *
 * 由于 TypeScript 接口不支持 static 成员，不能通过 implements 使用。
 * 用法：在类中实现 static getInstance() 和 static resetInstance()，
 *       然后通过类型断言验证：const _check: ISingleton<typeof MyClass> = MyClass;
 */
export interface ISingleton<T> {
    getInstance(): T;
    resetInstance(): void;
}
