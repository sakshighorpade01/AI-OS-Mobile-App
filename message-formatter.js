class MessageFormatter {
    constructor() {
        this.pendingContent = new Map();

        marked.setOptions({
            breaks: true,
            gfm: true,
            pedantic: false,
            silent: true,
            highlight: (code, lang) => {
                if (!lang) return hljs.highlightAuto(code).value;
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch {
                    return hljs.highlightAuto(code).value;
                }
            }
        });

        const renderer = {
            code: (code, language) => {
                if (language === 'mermaid') {
                    const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
                    return `<div class="mermaid" id="${id}">${code}</div>`;
                }

                const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
                const highlightedCode = hljs.highlight(code, { language: validLanguage }).value;
                return `<pre><code class="hljs language-${validLanguage}">${highlightedCode}</code></pre>`;
            },
            table: (header, body) => {
                return `<div class="table-container"><table class="formatted-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
            }
        };

        marked.use({ renderer });
    }

    formatStreaming(content, messageId) {
        if (!this.pendingContent.has(messageId)) {
            this.pendingContent.set(messageId, '');
        }

        this.pendingContent.set(messageId, this.pendingContent.get(messageId) + content);

        const formattedContent = this.format(this.pendingContent.get(messageId));

        return formattedContent;
    }

    format(content) {
        if (!content) return '';

        const cleanContent = DOMPurify.sanitize(content, {
            ADD_TAGS: ['div', 'span', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
            ADD_ATTR: ['class', 'id']
        });

        return marked.parse(cleanContent);
    }

    finishStreaming(messageId) {
        this.pendingContent.delete(messageId);
    }
}

export const messageFormatter = new MessageFormatter();