/**
 * AI 封面生成引擎
 * 根据书名+类型自动匹配配色方案和装饰元素
 * 纯 CSS 渲染，不依赖图片 API
 */

const CoverEngine = {
    // 预设风格模板（离线兜底）
    PRESETS: {
        '科幻': {
            gradient: ['#0a0a2e', '#1a1a4e', '#0d1b3e'],
            textColor: '#c8e6ff',
            decoration: 'stars',
            layout: 'centered'
        },
        '奇幻': {
            gradient: ['#1a2d1a', '#0d2d1a', '#1a3d2d'],
            textColor: '#d0f0d0',
            decoration: 'rings',
            layout: 'centered'
        },
        '悬疑': {
            gradient: ['#1a0a0a', '#2d0a0a', '#1a0505'],
            textColor: '#e8cccc',
            decoration: 'moon',
            layout: 'centered'
        },
        '言情': {
            gradient: ['#2d1a2d', '#3d1a3d', '#2a1a35'],
            textColor: '#f8d8e8',
            decoration: 'heart',
            layout: 'centered'
        },
        '武侠': {
            gradient: ['#1a1a0d', '#2d2a0d', '#1a1505'],
            textColor: '#f0e8c8',
            decoration: 'lines',
            layout: 'vertical'
        },
        '历史': {
            gradient: ['#1a1510', '#2d2015', '#1a1008'],
            textColor: '#e8d8c0',
            decoration: 'lines',
            layout: 'centered'
        },
        '都市': {
            gradient: ['#1a1a2e', '#2a2a3e', '#1a1a30'],
            textColor: '#d0d8f0',
            decoration: 'stars',
            layout: 'centered'
        },
        '恐怖': {
            gradient: ['#0d0d0d', '#1a0505', '#0a0000'],
            textColor: '#d8c8c8',
            decoration: 'blood',
            layout: 'centered'
        },
        '其他': {
            gradient: ['#1a1a2e', '#2a2a35', '#1a1a30'],
            textColor: '#d0d0e8',
            decoration: 'simple',
            layout: 'centered'
        }
    },

    /**
     * 根据书名和类型生成封面样式
     */
    generate(book) {
        const genre = book.genre || '其他';
        return this.PRESETS[genre] || this.PRESETS['其他'];
    },

    /**
     * 用 AI 生成封面样式（需要网络和已配置的模型）
     */
    async aiGenerate(book) {
        const prompt = `你是一位书籍封面设计师。请根据以下信息，输出一个封面配色方案的 JSON：
书名：${book.name}
类型：${book.genre||'未分类'}
简介：${book.desc||'无'}

请返回纯 JSON，格式如下（不要有其他文字）：
{
  "gradient": ["颜色1", "颜色2", "颜色3"],
  "textColor": "文字颜色",
  "decoration": "stars|rings|moon|heart|lines|blood|simple",
  "layout": "centered|vertical"
}

配色要求：
- 科幻：深空蓝黑系
- 悬疑：暗红黑系
- 言情：紫粉柔色系
- 奇幻：墨绿魔法系
- 武侠：古纸黄褐系
- 历史：沉稳棕褐系
- 都市：夜空蓝灰系
- 恐怖：极致暗黑系
- 颜色用十六进制格式`;

        try {
            const messages = [
                { role: 'system', content: '你只输出 JSON，不输出任何其他文字。' },
                { role: 'user', content: prompt }
            ];
            const result = await AIService.callAPI(messages, { temperature: 0.3, maxTokens: 500 });
            if (result) {
                const json = JSON.parse(result.trim().replace(/```json|```/g, ''));
                return {
                    gradient: json.gradient || this.PRESETS['其他'].gradient,
                    textColor: json.textColor || '#d0d0e8',
                    decoration: json.decoration || 'simple',
                    layout: json.layout || 'centered'
                };
            }
        } catch (e) {
            console.warn('[CoverEngine] AI 生成失败，使用预设模板:', e.message);
        }
        return this.generate(book);
    },

    /**
     * 渲染封面 HTML
     */
    renderHTML(book, coverStyle) {
        const style = coverStyle || this.generate(book);
        const name = book.name || '未命名';
        const titleSize = name.length <= 3 ? '28px' : name.length <= 5 ? '24px' : '20px';
        const gradStr = style.gradient.map((c, i) => {
            const pct = Math.round(i * (100 / (style.gradient.length - 1)));
            return `${c} ${pct}%`;
        }).join(',');

        let decoHTML = '';
        switch (style.decoration) {
            case 'stars':
                decoHTML = this._starsHTML();
                break;
            case 'rings':
                decoHTML = '<div class="cover-rings"></div>';
                break;
            case 'moon':
                decoHTML = '<div class="cover-moon"></div>';
                break;
            case 'heart':
                decoHTML = '<div class="cover-heart">❤️</div>';
                break;
            case 'lines':
                decoHTML = '<div class="cover-lines"></div>';
                break;
            case 'blood':
                decoHTML = '<div class="cover-blood"></div><div class="cover-moon"></div>';
                break;
            case 'simple':
            default:
                decoHTML = '';
                break;
        }

        const isVertical = style.layout === 'vertical';
        const titleTag = isVertical
            ? `<span class="cover-title" style="font-size:${titleSize};color:${style.textColor};writing-mode:vertical-lr;letter-spacing:6px">${name}</span>`
            : `<span class="cover-title" style="font-size:${titleSize};color:${style.textColor}">${name}</span>`;

        return `
        <div class="book-card-cover ai-cover" style="background:linear-gradient(135deg,${gradStr})">
            ${decoHTML}
            ${titleTag}
        </div>`;
    },

    _starsHTML() {
        const stars = [];
        for (let i = 0; i < 10; i++) {
            const top = Math.random() * 90;
            const left = Math.random() * 90;
            const delay = Math.random() * 3;
            const size = Math.random() > 0.7 ? '2px' : '1px';
            stars.push(`<div class="cover-star" style="top:${top}%;left:${left}%;width:${size};height:${size};animation-delay:${delay}s"></div>`);
        }
        return `<div class="cover-stars">${stars.join('')}</div>`;
    }
};
