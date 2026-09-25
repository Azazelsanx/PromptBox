/**
 * 轻量 Markdown 渲染器（零依赖，Bot 指令预览用）
 *
 * 安全策略：先整体转义 HTML 特殊字符，再应用有限的 Markdown 语法，
 * 因此任意输入都不会注入原始 HTML（链接仅允许 http/https）。
 *
 * 支持语法：
 * - 围栏代码块（```）
 * - 标题（# ~ ####，映射为 h3 ~ h6）
 * - 无序列表（- / *）、有序列表（1. / 1、）
 * - 引用（>）
 * - 行内代码（`code`）、粗体（**bold**）、斜体（*italic*）
 * - 链接（[text](http(s)://...)）
 * - 空行分段，段内单换行渲染为 <br>
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch]);
}

/** 行内语法：行内代码 → 链接 → 粗体 → 斜体。行内代码先占位避免内部被二次替换。 */
function renderInline(text: string): string {
    const codes: string[] = [];
    let out = text.replace(/`([^`]+)`/g, (_match, code: string) => {
        codes.push(`<code class="md-code">${code}</code>`);
        return `\u0000${codes.length - 1}\u0000`;
    });
    out = out.replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codes[Number(index)]);
    return out;
}

export function renderMarkdownLite(source: string): string {
    if (!source || !source.trim()) return '';

    const lines = escapeHtml(source).split(/\r?\n/);
    const html: string[] = [];
    let paragraph: string[] = [];
    let listTag: 'ul' | 'ol' | null = null;
    let inCodeBlock = false;
    let codeLines: string[] = [];

    const flushParagraph = () => {
        if (paragraph.length) {
            html.push(`<p>${paragraph.join('<br>')}</p>`);
            paragraph = [];
        }
    };
    const closeList = () => {
        if (listTag) {
            html.push(`</${listTag}>`);
            listTag = null;
        }
    };

    for (const rawLine of lines) {
        const line = rawLine.replace(/\s+$/, '');

        // 围栏代码块开关
        if (/^```/.test(line.trim())) {
            if (inCodeBlock) {
                html.push(`<pre class="md-pre"><code>${codeLines.join('\n')}</code></pre>`);
                codeLines = [];
                inCodeBlock = false;
            } else {
                flushParagraph();
                closeList();
                inCodeBlock = true;
            }
            continue;
        }
        if (inCodeBlock) {
            codeLines.push(line);
            continue;
        }

        // 空行 → 分段
        if (!line.trim()) {
            flushParagraph();
            closeList();
            continue;
        }

        // 标题（escapeHtml 不影响 #）
        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            closeList();
            const level = Math.min(heading[1].length + 2, 6);
            html.push(`<h${level} class="md-h">${renderInline(heading[2])}</h${level}>`);
            continue;
        }

        // 引用（> 已被转义为 &gt;）
        const quote = line.match(/^&gt;\s?(.*)$/);
        if (quote) {
            flushParagraph();
            closeList();
            html.push(`<blockquote class="md-quote">${renderInline(quote[1])}</blockquote>`);
            continue;
        }

        // 列表（支持一级；有序列表兼容「1.」与「1、」）
        const unordered = line.match(/^\s*[-*]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+[.、]\s+(.+)$/);
        if (unordered || ordered) {
            flushParagraph();
            const wanted: 'ul' | 'ol' = unordered ? 'ul' : 'ol';
            if (listTag !== wanted) {
                closeList();
                html.push(`<${wanted} class="md-list">`);
                listTag = wanted;
            }
            html.push(`<li>${renderInline((unordered || ordered)![1])}</li>`);
            continue;
        }

        // 普通文本行
        closeList();
        paragraph.push(renderInline(line.trim()));
    }

    if (inCodeBlock && codeLines.length) {
        html.push(`<pre class="md-pre"><code>${codeLines.join('\n')}</code></pre>`);
    }
    flushParagraph();
    closeList();

    return html.join('\n');
}
