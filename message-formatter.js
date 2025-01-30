// message-formatter.js
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

        // Custom renderer for special elements
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
        // Accumulate content for streaming messages
        if (!this.pendingContent.has(messageId)) {
            this.pendingContent.set(messageId, '');
        }
        
        this.pendingContent.set(messageId, this.pendingContent.get(messageId) + content);
        
        // Process the accumulated content
        const formattedContent = this.format(this.pendingContent.get(messageId));
        
        return formattedContent;
    }

    format(content) {
        if (!content) return '';
        
        // Sanitize while preserving necessary HTML
        const cleanContent = DOMPurify.sanitize(content, {
            ADD_TAGS: ['div', 'span', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
            ADD_ATTR: ['class', 'id']
        });
        
        // Convert to markdown
        return marked.parse(cleanContent);
    }

    finishStreaming(messageId) {
        // Cleanup streaming state
        this.pendingContent.delete(messageId);
    }
}

export const messageFormatter = new MessageFormatter();