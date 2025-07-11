import { artifactHandler } from './artifact-handler.js';

class MessageFormatter {
    constructor() {
        this.pendingContent = new Map();
        
        if (window.mermaid) {
            window.mermaid.initialize({
                startOnLoad: true,
                theme: document.body.classList.contains('dark-mode') ? 'dark' : 'default',
                securityLevel: 'loose',
                fontFamily: 'inherit'
            });
            this.setupMermaidThemeObserver();
        } else {
            console.error("Mermaid library not found. Diagrams will not be rendered.");
        }

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
                let codeContent = code;
                let lang = language;

                // FIX: Intelligently parse the content to find the actual code.
                try {
                    const parsed = JSON.parse(code);
                    if (typeof parsed === 'object' && parsed !== null) {
                        if (parsed.raw) {
                            codeContent = parsed.raw;
                        } else if (parsed.code) {
                            codeContent = parsed.code;
                        } else {
                            codeContent = JSON.stringify(parsed, null, 2);
                        }
                        lang = parsed.language || language || 'json';
                    }
                } catch (e) {
                    // Not a JSON string, treat as plain code.
                }

                if (lang === 'mermaid') {
                    const artifactId = artifactHandler.createArtifact(codeContent, 'mermaid');
                    return `<button class="artifact-reference" data-artifact-id="${artifactId}">
                        <i class="fas fa-diagram-project"></i>
                        Click to view Mermaid diagram
                    </button>`;
                }

                const validLanguage = hljs.getLanguage(lang) ? lang : 'plaintext';
                const artifactId = artifactHandler.createArtifact(codeContent, validLanguage);
                return `<button class="artifact-reference" data-artifact-id="${artifactId}">
                    <i class="fas fa-code"></i>
                    Click to view ${validLanguage} code
                </button>`;
            }, 
            table: (header, body) => {
                return `<div class="table-container"><table class="formatted-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
            }
        };

        marked.use({ renderer });
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.artifact-reference');
            if (btn) {
                const artifactId = btn.dataset.artifactId;
                artifactHandler.reopenArtifact(artifactId);
            }
        });
    }

    setupMermaidThemeObserver() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (window.mermaid) {
                        const isDarkMode = mutation.target.classList.contains('dark-mode');
                        window.mermaid.initialize({ 
                            theme: isDarkMode ? 'dark' : 'default'
                        });
                        const mermaidDiagrams = document.querySelectorAll('.mermaid');
                        if (mermaidDiagrams.length > 0) {
                            window.mermaid.init(undefined, mermaidDiagrams);
                        }
                    }
                }
            });
        });
        observer.observe(document.body, { attributes: true });
    }

    formatStreaming(content, messageId) {
        if (!this.pendingContent.has(messageId)) {
            this.pendingContent.set(messageId, '');
        }

        this.pendingContent.set(messageId, this.pendingContent.get(messageId) + content);
        const formattedContent = this.format(this.pendingContent.get(messageId));

        setTimeout(() => {
            const mermaidDiagrams = document.querySelectorAll('.mermaid:not([data-processed="true"])');
            if (window.mermaid && mermaidDiagrams.length > 0) {
                window.mermaid.init(undefined, mermaidDiagrams);
            }
        }, 0);

        return formattedContent;
    }

    format(content) {
        if (!content) return '';
        const cleanContent = DOMPurify.sanitize(content);
        return marked.parse(cleanContent);
    }

    finishStreaming(messageId) {
        this.pendingContent.delete(messageId);
    }
}

export const messageFormatter = new MessageFormatter();