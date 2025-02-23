// artifact-handler.js
class ArtifactHandler {
    constructor() {
        this.artifacts = new Map();
        this.currentId = 0;
        this.init();
    }

    init() {
        const container = document.createElement('div');
        container.id = 'artifact-container';
        container.className = 'artifact-container hidden';
        
        container.innerHTML = `
            <div class="artifact-window">
                <div class="artifact-header">
                    <div class="artifact-title">Code/Diagram Viewer</div>
                    <button class="close-artifact-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="artifact-content"></div>
            </div>
        `;
        
        document.body.appendChild(container);
        
        container.querySelector('.close-artifact-btn').addEventListener('click', () => {
            this.hideArtifact();
        });
    }

    createArtifact(content, type) {
        const id = `artifact-${this.currentId++}`;
        this.artifacts.set(id, { content, type });
        return id;
    }

    showArtifact(content, type, artifactId = null) {
        const container = document.getElementById('artifact-container');
        const contentDiv = container.querySelector('.artifact-content');
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        
        // Clear previous content
        contentDiv.innerHTML = '';
        
        // Add new content based on type
        if (type === 'mermaid') {
            const mermaidDiv = document.createElement('div');
            mermaidDiv.className = 'mermaid';
            mermaidDiv.textContent = content;
            contentDiv.appendChild(mermaidDiv);
            mermaid.init(undefined, [mermaidDiv]);
        } else {
            // For code blocks
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = `language-${type}`;
            code.textContent = content;
            pre.appendChild(code);
            contentDiv.appendChild(pre);
            hljs.highlightElement(code);
        }
        
        // Show artifact and adjust chat position
        container.classList.remove('hidden');
        chatContainer.classList.add('with-artifact');
        inputContainer.classList.add('with-artifact');

        return artifactId || this.createArtifact(content, type);
    }

    hideArtifact() {
        const container = document.getElementById('artifact-container');
        const chatContainer = document.querySelector('.chat-container');
        const inputContainer = document.querySelector('.floating-input-container');
        
        container.classList.add('hidden');
        chatContainer.classList.remove('with-artifact');
        inputContainer.classList.remove('with-artifact');
    }

    reopenArtifact(artifactId) {
        const artifact = this.artifacts.get(artifactId);
        if (artifact) {
            this.showArtifact(artifact.content, artifact.type, artifactId);
        }
    }
}

export const artifactHandler = new ArtifactHandler();