// script.js
let currentPage = 0;
let totalPages = 0;
let pages = [];
let isAnimating = false;
let tocItems = [];
let bookData = null;
let isInitialized = false;

// 配置
const CONFIG = {
    // 不再需要 contentFile，改为从 manifest 加载
    imagesFolder: 'images/'
};

// 主初始化函数
async function initBook() {
    console.log('初始化电子书...');
    
    if (isInitialized) return;
    
    try {
        await loadContent();
        await buildPages();
        showPage(0);
        initInteractions();
        hideLoading();
        
        isInitialized = true;
        console.log('电子书初始化完成');
        
    } catch (error) {
        console.error('初始化失败:', error);
        showError(error.message || '未知错误');
    }
}

// 加载内容 - 修改为从 manifest.js 加载
async function loadContent() {
    console.log('从 manifest 加载内容...');
    
    // 检查 window.bookManifest 是否存在
    if (!window.bookManifest || !window.bookManifest.content) {
        throw new Error('未找到书籍内容，请检查 manifest.js 是否已正确引入。');
    }
    
    let text = window.bookManifest.content;
    if (!text.trim()) {
        throw new Error('书籍内容为空');
    }
    
    // 修复过度转义的反引号
    // 将 \\\` 替换为 `
    text = text.replace(/\\\`/g, '`');
    
    bookData = {
        rawText: text,
        htmlContent: null,
        toc: []
    };
    
    console.log('内容加载成功，字符数:', text.length);
    
    // 设置页面标题（如果 manifest 中有标题）
    if (window.bookManifest.title) {
        document.title = window.bookManifest.title;
    }
}

// HTML实体转义函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 处理行内Markdown
function processInlineMarkdown(text) {
    if (!text) return '';
    
    // 先转义所有HTML特殊字符
    text = escapeHtml(text);
    
    // 处理链接（使用正则表达式匹配 [text](url) 格式）
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, linkText, url) {
        // 对链接文本进行额外的转义处理
        const escapedText = linkText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<a href="${url}" class="md-link" target="_blank" rel="noopener noreferrer">${escapedText}</a>`;
    });
    
    // 处理行内代码（注意：要在链接处理之后）
    text = text.replace(/`([^`]+)`/g, function(match, code) {
        return `<code class="inline-code">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;
    });
    
    // 处理粗体（**text** 或 __text__）
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // 处理斜体（*text* 或 _text_）
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // 处理删除线（~~text~~）
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    return text;
}

// 解析Markdown并构建HTML
function parseMarkdown(text) {
    console.log('解析Markdown...');
    
    const lines = text.split('\n');
    let html = '';
    let toc = [];
    let metaItems = [];
    let hasTitle = false;
    let currentParagraph = '';
    let isIndented = false;
    let inBlockquote = false;
    let inCodeBlock = false;
    let codeBlockLanguage = '';
    let codeBlockContent = [];
    let headingIndex = 0;
    let inList = false;
    let listType = '';
    let listItems = [];
    
    // 处理每一行
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const trimmed = line.trim();
        const originalTrimmed = trimmed;
        
        // 检查缩进
        const isIndentLine = line.startsWith('    ');
        if (isIndentLine) {
            line = line.substring(4);
        }
        
        // 代码块开始
        if (trimmed.startsWith('```')) {
            if (!inCodeBlock) {
                // 开始代码块
                flushList();
                flushParagraph();
                inCodeBlock = true;
                codeBlockLanguage = trimmed.substring(3).trim() || '';
                codeBlockContent = [];
            } else {
                // 结束代码块
                inCodeBlock = false;
                const escapedContent = escapeHtml(codeBlockContent.join('\n'));
                html += `<pre class="code-block"><code class="language-${codeBlockLanguage}">${escapedContent}</code></pre>`;
                codeBlockContent = [];
                codeBlockLanguage = '';
            }
            continue;
        }
        
        // 在代码块中
        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }
        
        // 强制分页符（包括水平线标记）
        if (trimmed === '---' || /^[-*_]{3,}$/.test(trimmed)) {
            flushList();
            flushParagraph();
            if (inBlockquote) {
                inBlockquote = false;
                html += '</blockquote>';
            }
            html += '<div class="page-break"></div>';
            continue;
        }
        
        // 空行
        if (trimmed === '') {
            flushList();
            flushParagraph();
            if (inBlockquote) {
                inBlockquote = false;
                html += '</blockquote>';
            }
            continue;
        }
        
        // 检查标题（支持1-6级）
        const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
        if (headingMatch) {
            flushList();
            flushParagraph();
            if (inBlockquote) {
                inBlockquote = false;
                html += '</blockquote>';
            }
            
            const level = headingMatch[1].length;
            const titleText = headingMatch[2].trim();
            headingIndex++;
            const titleId = `h${headingIndex}`;
            
            // 生成对应的HTML标签
            const headingTag = `h${level}`;
            html += `<${headingTag} id="${titleId}">${processInlineMarkdown(titleText)}</${headingTag}>`;
            
            // 添加到目录
            toc.push({ 
                id: titleId, 
                text: titleText, 
                level: level, 
                page: -1 
            });
            
            if (level === 1 && !hasTitle) {
                hasTitle = true;
            }
            continue;
        }
        
        // 作者/日期信息
        if (trimmed.startsWith('@ ')) {
            flushList();
            flushParagraph();
            if (inBlockquote) {
                inBlockquote = false;
                html += '</blockquote>';
            }
            metaItems.push(trimmed.substring(2));
            continue;
        }
        
        const imgMatch = trimmed.match(/!\[(.*?)\]\((.*?)\)/);
        if (imgMatch) {
            flushList();
            flushParagraph();
            if (inBlockquote) {
                inBlockquote = false;
                html += '</blockquote>';
            }
            
            const altText = imgMatch[1];
            const imgSrc = imgMatch[2];
            
            // 检查是否是网络链接
            const isExternal = /^(https?:)?\/\//i.test(imgSrc);
            const finalSrc = isExternal ? imgSrc : `${CONFIG.imagesFolder}${imgSrc}`;
            
            html += `<div class="image-container">
                <img src="${finalSrc}" alt="${altText}" 
                     style="max-width:100%; height:auto; display:block; margin:0 auto;"
                     onload="console.log('图片加载成功:', this.src)"
                     onerror="console.error('图片加载失败，请检查链接:', this.src); this.style.border='1px dashed red';">
                ${altText ? `<p class="image-caption">${processInlineMarkdown(altText)}</p>` : ''}
            </div>`;
            continue;
        }
        
        // 无序列表项
        if (/^[-*+]\s/.test(trimmed)) {
            flushParagraph();
            if (!inList || listType !== 'ul') {
                flushList();
                inList = true;
                listType = 'ul';
            }
            const listText = trimmed.substring(2);
            listItems.push(processInlineMarkdown(listText));
            continue;
        }
        
        // 引用块开始
        if (trimmed.startsWith('> ')) {
            if (!inBlockquote) {
                flushList();
                flushParagraph();
                inBlockquote = true;
                html += '<blockquote>';
            }
            
            const blockquoteText = trimmed.substring(2).trim();
            if (blockquoteText) {
                html += `<p>${processInlineMarkdown(blockquoteText)}</p>`;
            }
            continue;
        }
        
        // 普通文本
        flushList();
        if (currentParagraph === '') {
            isIndented = isIndentLine;
        } else {
            if (!isIndentLine && isIndented) {
                flushParagraph();
                currentParagraph = line;
                isIndented = false;
                continue;
            }
        }
        
        currentParagraph = currentParagraph ? currentParagraph + ' ' + line : line;
    }
    
    // 处理未关闭的块
    flushList();
    flushParagraph();
    if (inBlockquote) {
        html += '</blockquote>';
    }
    
    // 添加meta信息
    if (metaItems.length > 0 && hasTitle) {
        const metaHTML = `<p class="meta">
            ${metaItems.map(item => `<span>${item}</span>`).join('')}
        </p>`;
        
        // 插入到第一个h1后面
        const h1Index = html.indexOf('</h1>');
        if (h1Index !== -1) {
            html = html.substring(0, h1Index) + metaHTML + html.substring(h1Index);
        }
    }
    
    bookData.htmlContent = html;
    bookData.toc = toc;
    
    console.log('解析完成，标题数量:', toc.length);
    
    // 辅助函数：输出当前段落
    function flushParagraph() {
        if (currentParagraph) {
            const processedText = processInlineMarkdown(currentParagraph);
            const cls = isIndented ? ' class="indented"' : '';
            html += `<p${cls}>${processedText}</p>`;
            currentParagraph = '';
            isIndented = false;
        }
    }
    
    // 辅助函数：输出列表
    function flushList() {
        if (listItems.length > 0) {
            const tag = listType === 'ol' ? 'ol' : 'ul';
            html += `<${tag} class="md-list">`;
            listItems.forEach(item => {
                html += `<li>${item}</li>`;
            });
            html += `</${tag}>`;
            listItems = [];
            inList = false;
            listType = '';
        }
    }
}

// 构建分页
async function buildPages() {
    console.log('构建分页...');
    
    parseMarkdown(bookData.rawText);
    
    const content = document.getElementById('bookContent');
    
    const pageHeight = content.offsetHeight;
    const pageWidth = content.offsetWidth;
    
    console.log('页面尺寸:', pageWidth, 'x', pageHeight);
    
    const tempContainer = document.createElement('div');
    tempContainer.style.cssText = `
        position: absolute;
        visibility: hidden;
        width: ${pageWidth}px;
        top: -9999px;
        left: -9999px;
    `;
    tempContainer.innerHTML = bookData.htmlContent;
    document.body.appendChild(tempContainer);
    
    const elements = Array.from(tempContainer.children);
    
    content.innerHTML = '';
    
    let currentPage = createPage();
    let currentHeight = 0;
    let forceBreak = false;
    
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        
        if (element.classList && element.classList.contains('page-break')) {
            forceBreak = true;
            continue;
        }
        
        if (forceBreak) {
            if (currentPage.querySelector('.page-content').children.length > 0) {
                content.appendChild(currentPage);
                pages.push(currentPage);
            }
            currentPage = createPage();
            currentHeight = 0;
            forceBreak = false;
        }
        
        const elementHeight = element.offsetHeight;
        
        if (currentHeight + elementHeight <= pageHeight || currentHeight === 0) {
            currentPage.querySelector('.page-content').appendChild(element.cloneNode(true));
            currentHeight += elementHeight;
        } else {
            if (currentPage.querySelector('.page-content').children.length > 0) {
                content.appendChild(currentPage);
                pages.push(currentPage);
            }
            
            currentPage = createPage();
            currentPage.querySelector('.page-content').appendChild(element.cloneNode(true));
            currentHeight = elementHeight;
        }
    }
    
    if (currentPage.querySelector('.page-content').children.length > 0) {
        content.appendChild(currentPage);
        pages.push(currentPage);
    }
    
    document.body.removeChild(tempContainer);
    
    totalPages = pages.length;
    console.log('创建了', totalPages, '页');
    
    updateTOCPages();
    initTOC();
}

// 创建页面元素
function createPage() {
    const page = document.createElement('div');
    page.className = 'page';
    
    const content = document.createElement('div');
    content.className = 'page-content';
    
    page.appendChild(content);
    return page;
}

// 更新目录页码
function updateTOCPages() {
    console.log('更新目录页码...');
    
    pages.forEach((page, pageIndex) => {
        const pageContent = page.querySelector('.page-content');
        if (pageContent) {
            const headings = pageContent.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
            
            headings.forEach(heading => {
                const headingId = heading.id;
                const tocItem = bookData.toc.find(item => item.id === headingId);
                if (tocItem && tocItem.page === -1) {
                    tocItem.page = pageIndex;
                    tocItem.element = heading;
                }
            });
        }
    });
    
    bookData.toc.forEach(item => {
        if (item.page === -1) {
            item.page = 0;
        }
    });
}

// 初始化目录
function initTOC() {
    console.log('初始化目录...');
    
    const tocContent = document.getElementById('tocContent');
    if (!tocContent) return;
    
    if (bookData.toc.length === 0) {
        tocContent.innerHTML = '<p style="text-align:center;padding:20px;">暂无目录</p>';
        return;
    }
    
    let tocHTML = '';
    
    bookData.toc.forEach(item => {
        let paddingLeft = 20;
        let borderColor = 'rgba(36, 36, 42, 0.3)';
        let fontSize = '1rem';
        
        if (item.level === 1) {
            paddingLeft = 20;
            borderColor = 'rgba(36, 36, 42, 0.8)';
            fontSize = '1.1rem';
            fontWeight = '700';
        } else if (item.level === 2) {
            paddingLeft = 30;
            borderColor = 'rgba(36, 36, 42, 0.6)';
            fontSize = '1rem';
            fontWeight = '600';
        } else if (item.level === 3) {
            paddingLeft = 40;
            borderColor = 'rgba(36, 36, 42, 0.4)';
            fontSize = '0.95rem';
            fontWeight = '500';
        } else {
            paddingLeft = 50;
            borderColor = 'rgba(36, 36, 42, 0.2)';
            fontSize = '0.9rem';
            fontWeight = '400';
        }
        
        tocHTML += `
            <div class="toc-item" data-id="${item.id}" data-page="${item.page}" 
                 style="padding-left: ${paddingLeft}px; 
                        border-left-color: ${borderColor};
                        font-size: ${fontSize};
                        font-weight: ${fontWeight};">
                ${item.text}
            </div>
        `;
    });
    
    tocContent.innerHTML = tocHTML;
    
    document.querySelectorAll('.toc-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const pageIndex = parseInt(item.getAttribute('data-page'));
            const headingId = item.getAttribute('data-id');
            
            if (pageIndex >= 0) {
                navigateToPage(pageIndex, headingId);
                closeTOC();
            }
        });
    });
}

// 显示页面
function showPage(index) {
    if (index < 0 || index >= pages.length) {
        console.error('无效页面索引:', index);
        return;
    }
    
    pages.forEach(page => {
        page.classList.remove('active');
        page.style.display = 'none';
        page.style.opacity = '0';
    });
    
    const targetPage = pages[index];
    targetPage.classList.add('active');
    targetPage.style.display = 'flex';
    
    setTimeout(() => {
        targetPage.style.opacity = '1';
    }, 10);
    
    currentPage = index;
    
    console.log('显示第', index + 1, '页/共', totalPages, '页');
    
    updateActiveTOCItem();
}

// 导航到指定页面
function navigateToPage(pageIndex, headingId = null) {
    if (pageIndex < 0 || pageIndex >= pages.length) return;
    
    if (isAnimating) return;
    isAnimating = true;
    
    const currentPageElement = pages[currentPage];
    if (currentPageElement) {
        currentPageElement.style.opacity = '0';
    }
    
    setTimeout(() => {
        showPage(pageIndex);
        
        if (headingId) {
            setTimeout(() => {
                const headingElement = document.getElementById(headingId);
                const pageContent = document.querySelector('.page.active .page-content');
                
                if (headingElement && pageContent) {
                    pageContent.scrollTop = headingElement.offsetTop - 20;
                }
            }, 50);
        }
        
        setTimeout(() => {
            isAnimating = false;
        }, 300);
    }, 300);
}

// 上一页
function prevPage() {
    if (currentPage > 0 && !isAnimating) {
        navigateToPage(currentPage - 1);
    }
}

// 下一页
function nextPage() {
    if (currentPage < totalPages - 1 && !isAnimating) {
        navigateToPage(currentPage + 1);
    }
}

// 更新目录活动项
function updateActiveTOCItem() {
    document.querySelectorAll('.toc-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const currentPageElement = pages[currentPage];
    if (currentPageElement) {
        const pageContent = currentPageElement.querySelector('.page-content');
        if (pageContent) {
            const firstHeading = pageContent.querySelector('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
            if (firstHeading) {
                const headingId = firstHeading.id;
                const tocItem = document.querySelector(`.toc-item[data-id="${headingId}"]`);
                if (tocItem) {
                    tocItem.classList.add('active');
                }
            }
        }
    }
}

// 初始化交互功能
function initInteractions() {
    console.log('初始化交互...');
    
    // 处理链接点击
    document.addEventListener('click', function(e) {
        if (e.target.matches('a.md-link') || e.target.closest('a.md-link')) {
            const link = e.target.matches('a.md-link') ? e.target : e.target.closest('a.md-link');
            const href = link.getAttribute('href');
            
            if (href && !href.startsWith('#')) {
                e.preventDefault();
                e.stopPropagation();
                window.open(href, '_blank', 'noopener,noreferrer');
            }
        }
    });
    
    const prevBtn = document.querySelector('button[onclick="prevPage()"]');
    const nextBtn = document.querySelector('button[onclick="nextPage()"]');
    
    if (prevBtn) {
        prevBtn.onclick = prevPage;
    }
    
    if (nextBtn) {
        nextBtn.onclick = nextPage;
    }
    
    const menuBtn = document.getElementById('menuBtn');
    if (menuBtn) {
        menuBtn.addEventListener('click', openTOC);
    }
    
    const closeBtn = document.getElementById('tocCloseBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeTOC);
    }
    
    document.addEventListener('keydown', (e) => {
        if (!isInitialized) return;
        
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            e.preventDefault();
            prevPage();
        } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            e.preventDefault();
            nextPage();
        }
    });
    
    let touchStartX = 0;
    let touchStartY = 0;
    
    document.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    
    document.addEventListener('touchend', (e) => {
        if (!isInitialized || isAnimating) return;
        
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;
        
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
            if (diffX > 0) {
                prevPage();
            } else {
                nextPage();
            }
        }
    }, { passive: true });
    
// 修改后的 wheel 事件监听（修复滑动问题）
document.addEventListener('wheel', (e) => {
    const pageContent = document.querySelector('.page.active .page-content');
    
    // 如果没有激活的页面内容，不阻止默认行为
    if (!pageContent) {
        return;
    }
    
    // 检查是否在目录面板中滚动
    const tocPanel = document.getElementById('tocPanel');
    const tocContent = document.getElementById('tocContent');
    const tocOverlay = document.getElementById('tocOverlay');
    
    // 如果是在目录面板或目录遮罩层上滚动，不阻止默认行为
    if ((tocPanel && tocPanel.contains(e.target)) || 
        (tocContent && tocContent.contains(e.target)) ||
        (tocOverlay && tocOverlay.contains(e.target))) {
        return;
    }
    
    // 检查是否在构建页面中（build.html）
    if (document.querySelector('.build-container')) {
        return; // 构建页面允许自由滚动
    }
    
    // 只在电子书页面内容滚动到底部/顶部时阻止默认行为
    const delta = e.deltaY;
    const scrollTop = pageContent.scrollTop;
    const scrollHeight = pageContent.scrollHeight;
    const height = pageContent.clientHeight;
    
    // 允许小幅度的滚动（更自然的体验）
    const tolerance = 5; // 容差像素
    
    if ((delta > 0 && scrollTop + height >= scrollHeight - tolerance) ||
        (delta < 0 && scrollTop <= tolerance)) {
        e.preventDefault();
    }
}, { passive: false });
    
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (isInitialized) {
                console.log('窗口大小变化，重新分页');
                rebuildPages();
            }
        }, 250);
    });
}

// 重新分页
function rebuildPages() {
    const oldPageIndex = currentPage;
    
    const content = document.getElementById('bookContent');
    content.innerHTML = '';
    pages = [];
    
    buildPages().then(() => {
        const newIndex = Math.min(oldPageIndex, totalPages - 1);
        showPage(newIndex);
    }).catch(error => {
        console.error('重新分页失败:', error);
        showPage(0);
    });
}

// 打开目录
function openTOC() {
    if (!isInitialized) return;
    
    document.getElementById('tocPanel').classList.add('show');
    
    const overlay = document.createElement('div');
    overlay.className = 'toc-overlay show';
    overlay.id = 'tocOverlay';
    overlay.addEventListener('click', closeTOC);
    document.body.appendChild(overlay);
}

// 关闭目录
function closeTOC() {
    document.getElementById('tocPanel').classList.remove('show');
    const overlay = document.getElementById('tocOverlay');
    if (overlay) {
        overlay.remove();
    }
}

// 隐藏加载界面
function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 500);
    }
    
    const controls = document.querySelector('.controls');
    if (controls) {
        controls.style.opacity = '1';
    }
}

// 显示错误
function showError(message) {
    console.error('显示错误:', message);
    
    const content = document.getElementById('bookContent');
    if (content) {
        content.innerHTML = `
            <div class="error">
                <h1>错误</h1>
                <p>${message}</p>
                <p>请检查 manifest.js 文件是否已正确引入。</p>
                <button onclick="location.reload()" style="
                    margin-top: 20px;
                    padding: 10px 20px;
                    background: #24242a;
                    color: white;
                    border: none;
                    cursor: pointer;
                    font-family: inherit;
                ">重新加载</button>
            </div>
        `;
    }
    
    hideLoading();
}

// 导出全局函数
window.prevPage = prevPage;
window.nextPage = nextPage;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBook);
} else {
    initBook();
}

// 处理行内Markdown - 添加对<br>的支持
function processInlineMarkdown(text) {
    if (!text) return '';
    
    // 先转义所有HTML特殊字符，但保留<br>标签
    const div = document.createElement('div');
    div.textContent = text;
    let escapedText = div.innerHTML;
    
    // 将<br>标签从转义状态恢复回来
    escapedText = escapedText.replace(/&lt;br&gt;/gi, '<br>');
    
    // 处理链接（使用正则表达式匹配 [text](url) 格式）
    escapedText = escapedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(match, linkText, url) {
        // 对链接文本进行额外的转义处理，但保留其中的<br>标签
        const escapedLinkText = linkText
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/&lt;br&gt;/gi, '<br>');
        return `<a href="${url}" class="md-link" target="_blank" rel="noopener noreferrer">${escapedLinkText}</a>`;
    });
    
    // 处理行内代码（注意：要在链接处理之后，且不处理代码中的<br>）
    escapedText = escapedText.replace(/`([^`]+)`/g, function(match, code) {
        // 在代码块中，完全转义HTML，不保留<br>
        return `<code class="inline-code">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;
    });
    
    // 处理粗体（**text** 或 __text__）
    escapedText = escapedText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    escapedText = escapedText.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // 处理斜体（*text* 或 _text_）
    escapedText = escapedText.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    escapedText = escapedText.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // 处理删除线（~~text~~）
    escapedText = escapedText.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    return escapedText;
}