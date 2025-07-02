import { artifactHandler } from './artifact-handler.js';

class MessageFormatter {
    constructor() {
        this.pendingContent = new Map();
        
        // FIX: Access mermaid from the global window object
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
                if (language === 'mermaid') {
                    // No need to check for window.mermaid here, as it's handled in the formatting functions
                    const artifactId = artifactHandler.showArtifact(code, 'mermaid');
                    return `<button class="artifact-reference" data-artifact-id="${artifactId}">
                        <i class="fas fa-diagram-project"></i>
                        Click to view Mermaid diagram
                    </button>`;
                }

                const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
                const artifactId = artifactHandler.showArtifact(code, validLanguage);
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
                    const isDarkMode = mutation.target.classList.contains('dark-mode');
                    // FIX: Access mermaid from the global window object
                    if (window.mermaid) {
                        window.mermaid.initialize({ 
                            theme: isDarkMode ? 'dark' : 'default'
                        });
                        if (document.querySelectorAll('.mermaid').length > 0) {
                            window.mermaid.init(undefined, document.querySelectorAll('.mermaid'));
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
            // FIX: Access mermaid from the global window object
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