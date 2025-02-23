import { artifactHandler } from './artifact-handler.js';
class MessageFormatter {
    constructor() {
        this.pendingContent = new Map();
        
        // Initialize Mermaid with default configuration
        mermaid.initialize({
            startOnLoad: true,
            theme: document.body.classList.contains('dark-mode') ? 'dark' : 'default',
            securityLevel: 'loose',
            fontFamily: 'inherit'
        });

        // Set up theme observer for Mermaid
        this.setupMermaidThemeObserver();

        // Configure marked options
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

        // Set up custom renderer
        const renderer = {
            code: (code, language) => {
                if (language === 'mermaid') {
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
        // Create MutationObserver to handle theme changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    // Update Mermaid theme based on dark mode
                    const isDarkMode = mutation.target.classList.contains('dark-mode');
                    mermaid.initialize({ 
                        theme: isDarkMode ? 'dark' : 'default'
                    });

                    // Re-render existing Mermaid diagrams
                    if (mutation.target.querySelectorAll('.mermaid').length > 0) {
                        mermaid.init(undefined, mutation.target.querySelectorAll('.mermaid'));
                    }
                }
            });
        });

        // Start observing the body element for class changes
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
        });
    }

    formatStreaming(content, messageId) {
        if (!this.pendingContent.has(messageId)) {
            this.pendingContent.set(messageId, '');
        }

        this.pendingContent.set(messageId, this.pendingContent.get(messageId) + content);

        const formattedContent = this.format(this.pendingContent.get(messageId));

        // Initialize any new Mermaid diagrams after formatting
        setTimeout(() => {
            const mermaidDiagrams = document.querySelectorAll('.mermaid:not([data-processed="true"])');
            if (mermaidDiagrams.length > 0) {
                mermaid.init(undefined, mermaidDiagrams);
            }
        }, 0);

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