/**
 * @icon-park/vue-next 包内 icons.json 的精简类型声明。
 * 完整 JSON 约 824KB / 2658 条，若走 resolveJsonModule 字面量推导会拖垮 tsc，
 * 故用环境模块声明收窄为搜索所需的字段。
 */
declare module '@icon-park/vue-next/icons.json' {
    interface IconparkIconMeta {
        title: string
        name: string
        category: string
        categoryCN: string
        tag: string[]
        author: string
    }
    const icons: IconparkIconMeta[]
    export default icons
}
