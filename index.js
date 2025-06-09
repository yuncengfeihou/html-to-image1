
// public/extensions/third-party/scane_hti/index.js - Migrated to html-to-image

import {
    extension_settings,
    getContext,
    renderExtensionTemplateAsync,
} from '../../../extensions.js';

import {
    saveSettingsDebounced,
    eventSource,
    event_types,
} from '../../../../script.js';

import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

// 插件的命名空间，与 manifest.json 中的文件夹名称一致
const PLUGIN_ID = 'html-to-image1'; // 或 'scane_hti'
const PLUGIN_NAME = 'ST截图 (html-to-image)'; // 更新插件名

// 插件的默认设置 (更新适配 html-to-image)
const defaultSettings = {
    screenshotDelay: 20,       // 确保UI渲染
    autoInstallButtons: true,
    altButtonLocation: true, // 保留设置，虽然UI隐藏
    screenshotScale: 2.0,      // 对应 html-to-image 的 pixelRatio
    // useForeignObjectRendering: true, // html-to-image 总是使用，此设置不再传入options
    imageTimeout: 5000,        // 对应 html-to-image 的 timeout
    debugOverlay: true,        
    cacheBust: true,           // 对应 html-to-image 的 cacheBust
    // corsImg 配置对于 html-to-image 不是直接参数，但库内部可能用到fetch
};

// 全局配置对象，将从设置中加载
const config = {
    buttonClass: 'st-screenshot-button',
    chatScrollContainerSelector: '#chat',
    chatContentSelector: '#chat',
    messageSelector: '.mes',
    lastMessageSelector: '.mes.last_mes',
    messageTextSelector: '.mes_block .mes_text',
    messageHeaderSelector: '.mes_block .ch_name',
     // 关键修改：重命名为 htmlToImageOptions 并设置默认值
    htmlToImageOptions: { 
        backgroundColor: null, // 确保背景透明
        includeFonts: true, // 尝试嵌入字体
        // 其他选项会从 settings 加载
    }
};

// 确保插件设置已加载并与默认值合并
function getPluginSettings() {
    // 初始化
    if (typeof extension_settings[PLUGIN_ID] === 'undefined') {
         extension_settings[PLUGIN_ID] = {};
    }
   // 合并默认值和已保存的值
    extension_settings[PLUGIN_ID] = Object.assign({}, defaultSettings, extension_settings[PLUGIN_ID]);
    return extension_settings[PLUGIN_ID];
}

// 加载并应用配置 (关键修改：映射选项)
function loadConfig() {
    const settings = getPluginSettings();

    // 基本配置
    config.screenshotDelay = parseInt(settings.screenshotDelay, 10) || 0;
    config.debugOverlay = settings.debugOverlay !== undefined ? settings.debugOverlay : defaultSettings.debugOverlay;
    
    // 初始化选项，设置库的默认值
     config.htmlToImageOptions = {
        backgroundColor: null,
        includeFonts: true,
     };

    // 将用户设置映射到 html-to-image options
    const loadedScale = parseFloat(settings.screenshotScale);
    // 映射: scale -> pixelRatio
    config.htmlToImageOptions.pixelRatio = (!isNaN(loadedScale) && loadedScale > 0) ? loadedScale : defaultSettings.screenshotScale;
   
    // 映射: imageTimeout -> timeout
    config.htmlToImageOptions.timeout = settings.imageTimeout || defaultSettings.imageTimeout;
     // 映射: cacheBust -> cacheBust
    config.htmlToImageOptions.cacheBust = settings.cacheBust !== undefined ? settings.cacheBust : defaultSettings.cacheBust;
     // 注意: useForeignObjectRendering 不再映射，因为 html-to-image 总是使用它
    
    console.log(`${PLUGIN_NAME}: 配置已加载并应用 (html-to-image):`, config);

    config.autoInstallButtons = settings.autoInstallButtons;
}

// === 动态加载脚本的辅助函数 (保持在 jQuery 闭包外部) ===
async function loadScript(src) {
    return new Promise((resolve, reject) => {
       // 检查是否已加载
        if (document.querySelector(`script[src="${src}"]`)) {
             console.log(`[${PLUGIN_NAME}] 脚本已存在，跳过加载: ${src}`);
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            console.log(`[${PLUGIN_NAME}] 脚本加载成功: ${src}`);
            resolve();
        };
        script.onerror = (error) => {
            console.error(`[${PLUGIN_NAME}] 脚本加载失败: ${src}`, error);
            reject(new Error(`Failed to load script: ${src}`));
        };
        document.head.appendChild(script);
    });
}


// 保留字体加载逻辑，对 html-to-image 有益
async function inlineFonts(cssUrl) {
     // 简化处理: 仅等待字体加载，html-to-image 的 includeFonts:true 会处理嵌入
     try {
        if (document.fonts && document.fonts.ready) {
           await document.fonts.ready;
           console.log(`${PLUGIN_NAME}: 字体加载检查完成`);
        }
     } catch(e) {
        console.warn(`${PLUGIN_NAME}: 检查字体加载状态时出错`, e);
     }
}

// SillyTavern 插件入口点
jQuery(async () => {
    console.log(`${PLUGIN_NAME}: 等待字体加载…`);
    await inlineFonts(); // 等待字体
   
    console.log(`${PLUGIN_NAME}: 插件初始化中...`);

    // === 关键修改：动态加载 html-to-image.min.js ===
    try {
        // 确保路径正确
        await loadScript(`/scripts/extensions/third-party/${PLUGIN_ID}/html-to-image.min.js`);
         // 关键修改：检查全局对象 htmlToImage
        if (typeof htmlToImage === 'undefined') {
            throw new Error('htmlToImage global object not found after loading script.');
        }
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 无法加载 html-to-image.min.js。插件功能将受限。`, error);
        alert(`${PLUGIN_NAME}: 核心库 html-to-image.min.js 加载失败，截图功能不可用。请检查文件路径 /scripts/extensions/third-party/${PLUGIN_ID}/html-to-image.min.js 或网络连接。`);
        return; // 加载失败则停止初始化
    }

    // 1. 加载配置（从 extension_settings）
    loadConfig();

    // 2. 注册设置面板
    let settingsHtml;
    try {
         // 确保 settings.html 路径正确
        settingsHtml = await renderExtensionTemplateAsync(`third-party/${PLUGIN_ID}`, 'settings');
        console.log(`${PLUGIN_NAME}: 成功加载设置面板模板`);
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 无法加载设置面板模板:`, error);
        // 如果模板加载失败，这里可以提供一个基础的 fallback HTML (原代码中有，此处省略以求简洁，假设模板总能加载)
         settingsHtml = `<div>${PLUGIN_NAME} 设置模板加载失败</div>`
    }

    $('#extensions_settings_content').append(settingsHtml);

    // 3. 绑定设置界面元素和事件
    const settingsForm = $('#extensions_settings_content');

    const screenshotDelayEl = settingsForm.find('#st_h2c_screenshotDelay');
    const screenshotScaleEl = settingsForm.find('#st_h2c_screenshotScale');
    // const useForeignObjectRenderingEl = settingsForm.find('#st_h2c_useForeignObjectRendering'); // HTML中已禁用，不再读取
    const autoInstallButtonsEl = settingsForm.find('#st_h2c_autoInstallButtons');
    const altButtonLocationEl = settingsForm.find('#st_h2c_altButtonLocation'); // 保留读取，虽然UI隐藏
    const saveSettingsBtn = settingsForm.find('#st_h2c_saveSettingsBtn');
    const saveStatusEl = settingsForm.find('#st_h2c_saveStatus');
    const captureLastMsgBtn = settingsForm.find('#st_h2c_captureLastMsgBtn');
    const imageTimeoutEl = settingsForm.find('#st_h2c_imageTimeout');
    const cacheBustEl = settingsForm.find('#st_h2c_cacheBust');
    const debugOverlayEl = settingsForm.find('#st_h2c_debugOverlay');

    function updateSettingsUI() {
        const settings = getPluginSettings();
        screenshotDelayEl.val(settings.screenshotDelay);
        screenshotScaleEl.val(settings.screenshotScale);
        // useForeignObjectRenderingEl.prop('checked', settings.useForeignObjectRendering); // HTML中已禁用
        autoInstallButtonsEl.prop('checked', settings.autoInstallButtons);
        altButtonLocationEl.prop('checked', settings.altButtonLocation !== undefined ? settings.altButtonLocation : true);
        
        if (imageTimeoutEl) imageTimeoutEl.val(settings.imageTimeout);
        if (cacheBustEl) cacheBustEl.prop('checked', settings.cacheBust);
        if (debugOverlayEl) debugOverlayEl.prop('checked', settings.debugOverlay);
    }

    saveSettingsBtn.on('click', () => {
        const settings = getPluginSettings();

        settings.screenshotDelay = parseInt(screenshotDelayEl.val(), 10) || defaultSettings.screenshotDelay;
        settings.screenshotScale = parseFloat(screenshotScaleEl.val()) || defaultSettings.screenshotScale;
        // settings.useForeignObjectRendering = useForeignObjectRenderingEl.prop('checked'); // HTML中已禁用,不再保存
        settings.autoInstallButtons = autoInstallButtonsEl.prop('checked');
        settings.altButtonLocation = altButtonLocationEl.prop('checked'); // 保留
        settings.imageTimeout = parseInt(imageTimeoutEl.val(), 10) || defaultSettings.imageTimeout;
         if (cacheBustEl) settings.cacheBust = cacheBustEl.prop('checked');
         if (debugOverlayEl) settings.debugOverlay = debugOverlayEl.prop('checked');

        saveSettingsDebounced();
        saveStatusEl.text("设置已保存!").css('color', '#4cb944').show();
        setTimeout(() => saveStatusEl.hide(), 1000);

        loadConfig(); // 重新加载配置以应用 pixelRatio, timeout 等
        // 重新安装或移除按钮
        document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
        if (config.autoInstallButtons) {
            installScreenshotButtons();
        } 
		$('#extensions_settings').hide();     // SillyTavern 本体的设置侧栏
    });

    captureLastMsgBtn.on('click', async () => {
        const options = { target: 'last', includeHeader: true };
        try {
            // 关键修改：更新错误信息文本
            const dataUrl = await captureMessageWithOptions(options);
            if (dataUrl) {
                downloadImage(dataUrl, null, options.target);
            } else {
                throw new Error('未能生成截图 (html-to-image)');
            }
        } catch (error) {
            console.error('从设置面板截图失败 (html-to-image):', error.stack || error);
            alert(`截图失败: ${error.message || '未知错误'}`);
        }
    });

    updateSettingsUI();

    if (config.autoInstallButtons) {
        installScreenshotButtons();
    } else {
        console.log(`${PLUGIN_NAME}: 自动安装截图按钮已禁用.`);
    }

     // 增加延迟确保UI就绪
    setTimeout(waitForExtensionsMenu, 500);
    console.log(`${PLUGIN_NAME}: 插件初始化完成.`);

    // 创建并添加扩展菜单按钮 (与原脚本相同)
    function addExtensionMenuButton() {
        if ($(`#extensionsMenu .fa-camera[data-plugin-id="${PLUGIN_ID}"]`).length > 0) {
             return;
         }
        const menuButton = document.createElement('div');
        menuButton.classList.add('extensionsMenuExtension');
    
        const icon = document.createElement('i');
        icon.classList.add('fa-solid', 'fa-camera');
        menuButton.appendChild(icon);
    
        menuButton.appendChild(document.createTextNode('截图设置'));
        menuButton.title = PLUGIN_NAME;
        menuButton.setAttribute('data-plugin-id', PLUGIN_ID);
        menuButton.addEventListener('click', () => {
            const extensionsMenu = document.getElementById('extensionsMenu');
            if (extensionsMenu) extensionsMenu.style.display = 'none';
            showScreenshotPopup();
        });
         // 使用jQuery 查找和添加
        $('#extensionsMenu').append(menuButton);
    }

    // 显示截图功能弹窗 (更新错误信息)
    function showScreenshotPopup() {
         // 检查并移除旧的 overlay
        $('.st-screenshot-overlay').remove();
        
        const overlay = document.createElement('div');
        overlay.className = 'st-screenshot-overlay';
        Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', zIndex: '10000', display: 'flex', justifyContent: 'center', alignItems:'flex-start', backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' });

        const popup = document.createElement('div');
        popup.className = 'st-screenshot-popup st-settings-popup'; //复用css
        const bgColor = getComputedStyle(document.body).getPropertyValue('--SmartThemeBlurTintColor') || '#2a2a2a';
        const boxBorderColor = getComputedStyle(document.body).getPropertyValue('--SmartThemeBorderColor') || '#555';
        Object.assign(popup.style, { 
            backgroundColor: bgColor.trim(), 
            border: `1px solid ${boxBorderColor.trim()}`,
            padding: '20px', 
            borderRadius: '10px', 
            maxWidth: '300px', 
            marginTop: '35vh', 
            width: '100%', 
            overflowY: 'auto'
        });

        const options = [
            { id: 'last_msg', icon: 'fa-camera', text: '截取最后一条消息' },
            { id: 'conversation', icon: 'fa-images', text: '截取整个对话' },
            { id: 'settings', icon: 'fa-gear', text: '调整截图设置' }
        ];
        
        options.forEach(option => {
            const btn = document.createElement('div');
            btn.className = 'st-screenshot-option menu_button'; // 复用 menu_button 样式
             Object.assign(btn.style, { display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0', width: '100%', justifyContent: 'flex-start' });

            btn.innerHTML = `<i class="fa-solid ${option.icon}" style="font-size: 1.2em; width: 20px; text-align: center;"></i><span>${option.text}</span>`;
            
            btn.addEventListener('click', async () => {
                console.log(`[${PLUGIN_NAME}] ${option.id} clicked`);
                document.body.removeChild(overlay);
                
                try {
                    let dataUrl;
                    switch(option.id) {
                        case 'last_msg':
                             dataUrl = await captureMessageWithOptions({ target: 'last', includeHeader: true });
                            if (dataUrl) downloadImage(dataUrl, null, 'last_message');
                            break;
                        case 'conversation':
                             dataUrl = await captureMessageWithOptions({ target: 'conversation', includeHeader: true });
                            if (dataUrl) downloadImage(dataUrl, null, 'conversation');
                            break;
                        case 'settings':
                            showSettingsPopup(); 
                            break;
                    }
                } catch (error) {
                     // 关键修改：更新错误信息
                    console.error(`[${PLUGIN_NAME}] 操作失败 (html-to-image):`, error);
                    alert(`操作失败 (html-to-image): ${error.message || '未知错误'}`);
                }
            });
            popup.appendChild(btn);
        });
        
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    }

    function waitForExtensionsMenu() {
         // 使用 jQuery 选择器
        if ($('#extensionsMenu').length > 0) {
            addExtensionMenuButton();
            return;
        }
         // 如果菜单还不存在，延迟重试
         setTimeout(waitForExtensionsMenu, 200);
    }
   
});

// 准备单个元素：克隆并清理样式 - 无需修改
function prepareSingleElementForCapture(originalElement) {
  if (!originalElement) return null;
  const clonedElement = originalElement.cloneNode(true);
  
  // 移除按钮等交互元素
   clonedElement.querySelectorAll('.mes_buttons, .extraMesButtons, .swipe_left, .swipe_right, .st-screenshot-button').forEach(el => el.remove());

  // 创建一个新的样式元素，强制透明背景
  const style = document.createElement('style');
  // 增加 !important 确保覆盖
  style.textContent = `
      .mes, .mes_block, .mes_text, .mes_header, .mes_content, .ch_name, .msg_date {
        background: transparent !important;
        border-color: transparent !important; 
        box-shadow: none !important;
      }
       /* 可以根据需要添加更多样式重置 */
    `;
   clonedElement.appendChild(style);
   // 显式设置克隆元素本身的背景为透明
   clonedElement.style.background = 'transparent';
   clonedElement.style.backgroundColor = 'transparent';

  return clonedElement;
}

// 核心截图函数：使用 html-to-image
// 关键修改：重命名，参数名，API调用，日志
async function captureElementWithHtmlToImage(elementToCapture, htiUserOptions = {}) {
    console.log('Preparing to capture element with html-to-image:', elementToCapture);
    
    let overlay = null;
    if (config.debugOverlay) {
        overlay = createOverlay('使用 html-to-image 准备截图...');
        document.body.appendChild(overlay);
    }
    
    const elementsToHide = [
        document.querySelector("#top-settings-holder"),
        document.querySelector("#form_sheld"),
        overlay
    ].filter(el => el);
   
    let dataUrl = null;

    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-99999px'; // 移到更远
    tempContainer.style.top = '-99999px';
    tempContainer.style.padding = '15px'; // 增加一些边距
    tempContainer.style.backgroundColor = 'transparent'; // 容器也透明


    const chatContentEl = document.querySelector(config.chatContentSelector);
    let containerWidth = 'auto';
     // 获取实际渲染宽度
    const computedWidth = chatContentEl ? window.getComputedStyle(chatContentEl).width : (elementToCapture ? window.getComputedStyle(elementToCapture).width : 'auto');
    if(computedWidth && computedWidth !== 'auto') {
         containerWidth = computedWidth;
    }
     tempContainer.style.width = containerWidth;


    let preparedElement;
    try {
        if (overlay) updateOverlay(overlay, '准备元素结构...', 0.05);
        preparedElement = prepareSingleElementForCapture(elementToCapture);
        if (!preparedElement) throw new Error("Failed to prepare element for capture.");

        tempContainer.appendChild(preparedElement);
        document.body.appendChild(tempContainer);
        
         // 强制重绘/布局
         void tempContainer.offsetWidth; 

        if (config.screenshotDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, config.screenshotDelay));
        }

    } catch (e) {
        console.error("Error during element preparation (html-to-image):", e);
        if (overlay && document.body.contains(overlay)) {
             updateOverlay(overlay, `净化错误: ${e.message.substring(0, 60)}...`, 0);
        }
        if (tempContainer.parentElement === document.body) {
           document.body.removeChild(tempContainer);
        }
         removeOverlay(overlay, 3000);
        throw e;
    }

    try {
        if (overlay) updateOverlay(overlay, '正在渲染 (html-to-image)...', 0.3);
        
        // 关键修改：使用 htmlToImageOptions
        const finalHtmlToImageOptions = { ...config.htmlToImageOptions, ...htiUserOptions };
        console.log('html-to-image opts:', finalHtmlToImageOptions);
        
        // 关键修改：调用 htmlToImage.toPng
        dataUrl = await htmlToImage.toPng(tempContainer, finalHtmlToImageOptions);
        
        if (overlay) updateOverlay(overlay, '生成图像数据...', 0.8);

    } catch (error) {
        // 关键修改：更新错误信息
        console.error('html-to-image 截图失败:', error.stack || error);
        if (overlay && document.body.contains(overlay)) {
             const errorMsg = error && error.message ? error.message : "未知渲染错误";
             updateOverlay(overlay, `渲染错误 (html-to-image): ${errorMsg.substring(0, 60)}...`, 0);
        }
        throw error;
    } finally {
        if (tempContainer.parentElement === document.body) {
           document.body.removeChild(tempContainer);
        }
         removeOverlay(overlay, dataUrl ? 1200 : 3000, dataUrl ? '截图完成!' : null);
    }
    if (!dataUrl) throw new Error("html-to-image 未能生成图像数据。");
    console.log("DEBUG: html-to-image capture successful.");
    return dataUrl;
}

// Capture multiple messages using html-to-image
// 关键修改：重命名，参数名，API调用，日志
async function captureMultipleMessagesWithHtmlToImage(messagesToCapture, actionHint, htiUserOptions = {}) {
    if (!messagesToCapture || messagesToCapture.length === 0) {
        throw new Error("没有提供消息给 captureMultipleMessagesWithHtmlToImage");
    }
    console.log(`[captureMultipleMessagesWithHtmlToImage] Capturing ${messagesToCapture.length} messages. Hint: ${actionHint}`);

     let overlay = null;
     if (config.debugOverlay) {
         overlay = createOverlay(`组合 ${messagesToCapture.length} 条消息 (html-to-image)...`);
         document.body.appendChild(overlay);
      }

    let dataUrl = null;
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-99999px';
    tempContainer.style.top = '-99999px';
    tempContainer.style.padding = '15px';
     tempContainer.style.backgroundColor = 'transparent'; // 容器透明

    const chatContentEl = document.querySelector(config.chatContentSelector);
    let containerWidth = 'auto';
    const computedWidth = chatContentEl ? window.getComputedStyle(chatContentEl).width : 'auto';
     if(computedWidth && computedWidth !== 'auto') {
         containerWidth = computedWidth;
     } else if (messagesToCapture.length > 0) {
         const firstMsgWidth = window.getComputedStyle(messagesToCapture[0]).width;
         if(firstMsgWidth && firstMsgWidth !== 'auto') containerWidth = firstMsgWidth;
     }
     if(containerWidth === 'auto') {
         containerWidth = '800px'; 
         console.warn("Could not determine container width for multi-message capture, using fallback.");
     }
    tempContainer.style.width = containerWidth;


    if (overlay) updateOverlay(overlay, `准备 ${messagesToCapture.length} 条消息 (html-to-image)...`, 0.05);
    messagesToCapture.forEach(msg => {
        try {
            const preparedClone = prepareSingleElementForCapture(msg);
            if (preparedClone) {
                 // 增加消息间距
                 preparedClone.style.marginBottom = '10px';
                 tempContainer.appendChild(preparedClone);
            } else {
                 console.warn("Skipping null prepared clone for message:", msg);
            }
        } catch (e) {
            console.error("Error preparing message for multi-capture (html-to-image):", msg, e);
        }
    });
    document.body.appendChild(tempContainer);
     // 强制重绘
    void tempContainer.offsetWidth; 
    await new Promise(resolve => setTimeout(resolve, config.screenshotDelay)); // Allow render

    try {
         if (overlay) updateOverlay(overlay, '正在渲染 (html-to-image)…', 0.3);

        // 关键修改：使用 htmlToImageOptions
        const finalHtmlToImageOptions = { ...config.htmlToImageOptions, ...htiUserOptions };
        console.log("DEBUG: html-to-image (multiple) options:", finalHtmlToImageOptions);
        
        // 关键修改：调用 htmlToImage.toPng
        dataUrl = await htmlToImage.toPng(tempContainer, finalHtmlToImageOptions);

         if (overlay) updateOverlay(overlay, '生成图像数据...', 0.8);

    } catch (error) {
         // 关键修改：更新错误信息
        console.error('html-to-image 多消息截图失败:', error.stack || error);
         if (overlay && document.body.contains(overlay)) {
             const errorMsg = error && error.message ? error.message : "未知渲染错误";
             updateOverlay(overlay, `多消息渲染错误 (html-to-image): ${errorMsg.substring(0,50)}...`, 0);
        }
        throw error;
    } finally {
        if (tempContainer.parentElement === document.body) {
            document.body.removeChild(tempContainer);
        }
       removeOverlay(overlay, dataUrl ? 1200 : 3000, dataUrl ? '截图完成!' : null);
    }
    if (!dataUrl) throw new Error("html-to-image 未能生成多消息图像数据。");
    console.log("DEBUG: html-to-image multiple messages capture successful.");
    return dataUrl;
}


// Routes capture requests
// 关键修改：调用新的函数
async function captureMessageWithOptions(options) {
    const { target, includeHeader } = options;
    console.log('captureMessageWithOptions (html-to-image) called with:', options);

    const chatContentEl = document.querySelector(config.chatContentSelector);
    if (!chatContentEl) {
         const errorMsg = `聊天内容容器 '${config.chatContentSelector}' 未找到!`;
         console.error(`${PLUGIN_NAME}:`, errorMsg);
         throw new Error(errorMsg);
    }

    let elementToRender;
    let messagesForMultiCapture = [];

    switch (target) {
        case 'last':
            elementToRender = chatContentEl.querySelector(config.lastMessageSelector);
            if (!elementToRender) throw new Error('最后一条消息元素未找到');
            break;
        case 'selected': // ST 中可能没有这个类，但保留
            elementToRender = chatContentEl.querySelector(`${config.messageSelector}[data-selected="true"]`) || chatContentEl.querySelector(`${config.messageSelector}.selected`);
             // 如果没有选中，尝试最后一条
            if (!elementToRender) elementToRender = chatContentEl.querySelector(config.lastMessageSelector);
            if (!elementToRender) throw new Error('没有选中的或最后的消息');
            break;
        case 'conversation':
            messagesForMultiCapture = Array.from(chatContentEl.querySelectorAll(config.messageSelector));
            if (messagesForMultiCapture.length === 0) throw new Error("对话中没有消息可捕获。");
            // 关键修改：调用新函数
            return await captureMultipleMessagesWithHtmlToImage(messagesForMultiCapture, "conversation_all", {}); 
        default:
             // 允许直接传入元素
             if (target instanceof HTMLElement) {
                 elementToRender = target;
             } else {
                throw new Error('未知的截图目标类型或元素');
             }
    }

    if (!elementToRender && messagesForMultiCapture.length === 0) {
         throw new Error(`目标元素未找到 (for ${target} within ${config.chatContentSelector})`);
    }

    if (elementToRender) {
        let finalElementToCapture = elementToRender;
         // 截图消息文本部分
        if (!includeHeader && target !== 'conversation' && elementToRender.querySelector(config.messageTextSelector)) {
            const textElement = elementToRender.querySelector(config.messageTextSelector);
            if (textElement) {
                finalElementToCapture = textElement;
                console.log('Capturing text element only with html-to-image:', finalElementToCapture);
            } else {
                console.warn("Could not find text element for includeHeader: false, capturing full message.");
            }
        }
         // 关键修改：调用新函数
        return await captureElementWithHtmlToImage(finalElementToCapture, {}); 
    }
    throw new Error("captureMessageWithOptions (html-to-image): Unhandled capture scenario.");
}

let messageObserver = null; // 用于停止观察
// 安装截图按钮
function installScreenshotButtons() {
     // 停止旧的观察者并移除按钮
    if(messageObserver) messageObserver.disconnect();
    document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());

    const chatContentEl = document.querySelector(config.chatContentSelector);
    if (!chatContentEl) {
       console.warn(`${PLUGIN_NAME}: Chat content ('${config.chatContentSelector}') not found for initial button installation.`);
       return false;
    }
     // 初始安装
     chatContentEl.querySelectorAll(config.messageSelector).forEach(message => addScreenshotButtonToMessage(message));
   
    // 创建并启动新的观察者
    messageObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches(config.messageSelector) && !node.querySelector(`.${config.buttonClass}`)) {
                 // 延迟添加，确保消息内部结构加载完成
                 setTimeout(() => addScreenshotButtonToMessage(node), 50);
              } 
              // 处理像分组消息那样，新节点内部包含消息的情况
               else if (node.querySelectorAll) {
                 node.querySelectorAll(config.messageSelector).forEach(msg => {
                     if(!msg.querySelector(`.${config.buttonClass}`)){
                         setTimeout(() => addScreenshotButtonToMessage(msg), 50);
                     }
                 });
               }
            }
          });
        }
      });
    });

    messageObserver.observe(chatContentEl, { childList: true, subtree: true });
    console.log(`${PLUGIN_NAME}: 截图按钮安装逻辑及观察者已启动.`);
    return true;
}

// 添加截图按钮
// 关键修改：click 和 contextmenu 调用新函数
function addScreenshotButtonToMessage(messageElement) {
    if (!messageElement || !messageElement.querySelector || messageElement.querySelector(`.${config.buttonClass}`)) {
      return;
    }

    // 尝试找到按钮容器
    let buttonsContainer = messageElement.querySelector('.mes_buttons');
      if (!buttonsContainer) {
        // 如果没有找到，可能需要创建它或放弃
         // console.warn("mes_buttons not found for message", messageElement);
        return;
      }
  

    const screenshotButton = document.createElement('div');
    screenshotButton.innerHTML = '<i class="fa-solid fa-camera"></i>';
    screenshotButton.className = `${config.buttonClass} mes_button interactable`; 
    screenshotButton.title = '截图此消息 (右键/长按显示更多选项)'; // 更新提示
    screenshotButton.setAttribute('tabindex', '0');
    screenshotButton.style.cursor = 'pointer';
    screenshotButton.dataset.messageId = messageElement.getAttribute('mesid') || messageElement.id; // 存储ID便于查找

    // --- Context Menu Logic ---
     // 使用单例模式，避免重复创建菜单
     let contextMenu = document.querySelector('.st-screenshot-context-menu');
      if(!contextMenu){
         contextMenu = document.createElement('div');
         contextMenu.className = 'st-screenshot-context-menu';
         const bgColor = getComputedStyle(document.body).getPropertyValue('--SmartThemeBlurTintColor') || '#2a2a2a';
         const borderColor = getComputedStyle(document.body).getPropertyValue('--SmartThemeBorderColor') || '#555';
         const menuHoverColor = getComputedStyle(document.body).getPropertyValue('--SmartThemeBlurTintStrength') || '#4a4a4a';
         Object.assign(contextMenu.style, { display: 'none', position: 'fixed', zIndex: '10001', background: bgColor.trim(), border: `1px solid ${borderColor.trim()}`, borderRadius: '4px', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', padding: '5px 0', fontSize: '0.9em' });

         const menuOptions = [
             { text: '截取 [此条] 及之前共 4 条', action: 'prev3' }, // 注意：prev3 表示当前 + 之前3条 = 4条
             { text: '截取 [此条] 及之前共 3 条', action: 'prev2' },
             { text: '截取 [此条] 及之前共 2 条', action: 'prev1' },
             { text: '---', action: null}, // 分隔符
             { text: '截取 [此条] 文本部分', action: 'textOnly'},
              { text: '---', action: null}, // 分隔符
             { text: '截取 [此条] 及之后共 2 条', action: 'next1' }, // 注意：next1 表示当前 + 之后1条 = 2条
             { text: '截取 [此条] 及之后共 3 条', action: 'next2' },
             { text: '截取 [此条] 及之后共 4 条', action: 'next3' },
         ];

        menuOptions.forEach(option => {
           const menuItem = document.createElement('div');
           menuItem.className = 'st-screenshot-menu-item';
           menuItem.textContent = option.text;
            if(!option.action) { // 分隔符
                 Object.assign(menuItem.style, { height: '1px', backgroundColor: borderColor, margin: '4px 0', padding: '0', cursor: 'default'});
                  menuItem.textContent = '';
            } else {
               const btnBgColor = bgColor;
               Object.assign(menuItem.style, { padding: '8px 15px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background-color 0.2s', backgroundColor: btnBgColor.trim() });
               menuItem.onmouseover = () => menuItem.style.backgroundColor = menuHoverColor.trim();
               menuItem.onmouseout = () => menuItem.style.backgroundColor = btnBgColor.trim();
               menuItem.onclick = async (e) => {
                 e.stopPropagation(); 
                 const currentMsgId = contextMenu.dataset.targetMessageId;
                 const currentMsg = document.querySelector(`[mesid="${currentMsgId}"], #${currentMsgId}`);
                 hideContextMenu();
                 if(currentMsg){
                    // 关键修改：调用更新后的函数
                    await captureFromContextMenu(currentMsg, option.action); 
                 } else {
                    console.warn("Context menu target message not found:", currentMsgId);
                 }
               };
            }
           contextMenu.appendChild(menuItem);
         });
         document.body.appendChild(contextMenu);
         // 点击菜单外隐藏
         document.addEventListener('click', (e) => {
             if (contextMenu.style.display === 'block' && !contextMenu.contains(e.target) && !(e.target.closest && e.target.closest(`.${config.buttonClass}`))) {
                hideContextMenu();
             }
         }, true); // 使用捕获阶段，防止事件被其他元素停止
          document.addEventListener('scroll', hideContextMenu, true); // 滚动时隐藏
          window.addEventListener('resize', hideContextMenu);
     }


    let pressTimer, isLongPress = false;
    function showContextMenu(event, button) {
       const x = event.clientX;
       const y = event.clientY;
       contextMenu.dataset.targetMessageId = button.dataset.messageId; // 关联消息ID
       contextMenu.style.display = 'block';
       const vpW = window.innerWidth, vpH = window.innerHeight;
       const menuW = contextMenu.offsetWidth, menuH = contextMenu.offsetHeight;
       let finalX = x + 5;
       let finalY = y + 5;
       if (finalX + menuW > vpW) finalX = vpW - menuW - 10;
       if (finalY + menuH > vpH) finalY = vpH - menuH - 10;
        if (finalY < 0) finalY = 5;
        if (finalX < 0) finalX = 5;
       contextMenu.style.left = `${finalX}px`; 
       contextMenu.style.top = `${finalY}px`;
       event.preventDefault();
       event.stopPropagation();
    }
    function hideContextMenu() { 
        if(contextMenu) contextMenu.style.display = 'none'; 
        isLongPress = false; // Reset flag
        clearTimeout(pressTimer);
    }

    // --- Event Listeners for Button ---
    const startPress = (e) => {
         if (e.button && e.button !== 0) return; // only left click
         isLongPress = false;
         hideContextMenu(); // hide any open menu
         pressTimer = setTimeout(() => {
            isLongPress = true; 
            const event = e.touches ? e.touches[0] : e;
            showContextMenu(event, screenshotButton);
         }, 600); // 长按时间
    };
     const endPress = () => {
         clearTimeout(pressTimer);
     };

    screenshotButton.addEventListener('mousedown', startPress);
    screenshotButton.addEventListener('mouseup', endPress);
    screenshotButton.addEventListener('mouseleave', endPress);
    screenshotButton.addEventListener('touchstart', startPress, { passive: true });
    screenshotButton.addEventListener('touchend', endPress);
    screenshotButton.addEventListener('touchcancel', endPress);
     // 右键直接显示
     screenshotButton.addEventListener('contextmenu', (e) => {
         clearTimeout(pressTimer);
         isLongPress = true; // Treat right-click as long press to prevent click handler
         showContextMenu(e, screenshotButton);
     });

     // 点击事件 (非长按/右键)
    screenshotButton.addEventListener('click', async function(event) {
      event.preventDefault(); 
      event.stopPropagation();
       // 如果是长按或右键触发的，则忽略此次 click
      if (isLongPress) { 
         setTimeout(() => isLongPress = false, 100); // delay reset to handle touch end + click sequence
         return; 
      }
      hideContextMenu();
      if (this.classList.contains('loading')) return;

      const iconElement = this.querySelector('i');
      const originalIconClass = iconElement ? iconElement.className : '';
      if (iconElement) iconElement.className = `fa-solid fa-spinner fa-spin ${config.buttonClass}-icon-loading`;
      this.classList.add('loading');

      try {
         // 关键修改：调用新函数
        const dataUrl = await captureElementWithHtmlToImage(messageElement, {}); 
        downloadImage(dataUrl, messageElement, 'message');
      } catch (error) {
        // 关键修改：更新错误信息
        console.error('消息截图失败 (html-to-image button click):', error.stack || error);
        alert(`截图失败: ${error.message || '未知错误'}`);
      } finally {
        if (iconElement) iconElement.className = originalIconClass;
        this.classList.remove('loading');
         isLongPress = false; // Ensure reset
      }
    });

     // 插入按钮： 尝试放在编辑按钮之前，否则放在末尾
     const editButton = buttonsContainer.querySelector('.mes_edit');
     if (editButton) {
        buttonsContainer.insertBefore(screenshotButton, editButton);
     } else {
       buttonsContainer.appendChild(screenshotButton);
     }
}

// Handles context menu actions 
// 关键修改：调用新函数，action逻辑调整
async function captureFromContextMenu(currentMessageElement, action) {
    console.log(`[多消息截图 ctx menu html-to-image] Action: ${action} from msg:`, currentMessageElement);
    const button = currentMessageElement.querySelector(`.${config.buttonClass}`);
    const iconElement = button ? button.querySelector('i') : null;
    const originalIconClass = iconElement ? iconElement.className : '';

    if (button) button.classList.add('loading');
    if (iconElement) iconElement.className = `fa-solid fa-spinner fa-spin ${config.buttonClass}-icon-loading`;

    try {
        // 单独处理文本截图
        if(action === 'textOnly'){
            const dataUrl = await captureMessageWithOptions({ target: currentMessageElement, includeHeader: false });
             if (dataUrl) {
                  downloadImage(dataUrl, currentMessageElement, 'message_text');
             } else {
                  throw new Error('文本截图 html-to-image 生成失败');
             }
             return; // 提前返回
        }

        const chatContent = document.querySelector(config.chatContentSelector);
        if (!chatContent) throw new Error(`无法进行多消息截图，聊天内容容器 '${config.chatContentSelector}' 未找到!`);
        
        let allMessages = Array.from(chatContent.querySelectorAll(config.messageSelector));
        let currentIndex = allMessages.indexOf(currentMessageElement);
        if (currentIndex === -1) throw new Error('无法确定当前消息位置');

        let startIndex = currentIndex, endIndex = currentIndex;
         // action 调整: prev1 表示包括当前共2条
        const match = action.match(/^(prev|next)(\d+)$/);
         if(match){
            const direction = match[1];
            const count = parseInt(match[2], 10); // 1, 2, 3
             if(direction === 'prev'){
                 startIndex = Math.max(0, currentIndex - count); // 当前索引 - 数量
             } else { // next
                 endIndex = Math.min(allMessages.length - 1, currentIndex + count); // 当前索引 + 数量
             }
         } else {
            throw new Error(`未知多消息截图动作: ${action}`);
         }

        const targetMessages = allMessages.slice(startIndex, endIndex + 1);
        if (targetMessages.length <= 1) { // 如果只有一条或没有，则按单条处理
             console.warn(`Target messages count is ${targetMessages.length}, fallback to single message capture.`);
             if (targetMessages.length === 1) {
                 const dataUrlSingle = await captureElementWithHtmlToImage(targetMessages[0], {}); 
                 downloadImage(dataUrlSingle, targetMessages[0], 'message');
             }
             return;
        }


        // 关键修改：调用新函数
        const dataUrl = await captureMultipleMessagesWithHtmlToImage(targetMessages, action, {}); 

        if (dataUrl) {
             const count = targetMessages.length;
             const directionText = action.startsWith('prev') ? '前' : '后';
             const fileNameHint = `ST消息组_${directionText}${count}条`;
             downloadImage(dataUrl, currentMessageElement, fileNameHint);
        } else {
            throw new Error('多消息截图 html-to-image 生成失败');
        }
    } catch (error) {
        console.error(`[多消息截图 ctx menu html-to-image] 失败 (${action}):`, error.stack || error);
        alert(`截图 (${action}) 失败: ${error.message || '未知错误'}`);
    } finally {
        if (iconElement) iconElement.className = originalIconClass;
        if (button) button.classList.remove('loading');
    }
}


// Utility function to download (same as original)
function downloadImage(dataUrl, messageElement = null, typeHint = 'screenshot') {
     if(!dataUrl) return;
    const link = document.createElement('a');
    let filename = `SillyTavern_${typeHint.replace(/[^a-z0-9_-]/gi, '_')}`;
    try {
      if (messageElement && typeof messageElement.querySelector === 'function') {
        const nameSelector = config.messageHeaderSelector + ' .name_text';
        const nameFallbackSelector = config.messageHeaderSelector;
        const nameTextElement = messageElement.querySelector(nameSelector) || messageElement.querySelector(nameFallbackSelector);
        let senderName = 'Character';
        if (nameTextElement && nameTextElement.textContent) {
            senderName = nameTextElement.textContent.trim() || 'Character';
        }
        const isUser = messageElement.classList.contains('user_mes') || (messageElement.closest && messageElement.closest('.user_mes'));
        const sender = isUser ? 'User' : senderName;
        const msgIdData = messageElement.getAttribute('mesid') || messageElement.dataset.msgId || messageElement.id;
        const msgId = msgIdData ? msgIdData.replace(/\D/g,'').slice(-6) : ('m' + Date.now().toString().slice(-5)); // 取数字部分
        const timestampAttr = messageElement.dataset.timestamp || messageElement.getAttribute('data-timestamp') || new Date().toISOString();
        const timestamp = timestampAttr.replace(/[:\sTZ.]/g, '-').replace(/--+/g, '-').substring(0,19); // 格式化时间
        const filenameSafeSender = sender.replace(/[^a-z0-9\u4e00-\u9fa5_-]/gi, '_').substring(0, 20); // 允许中文
        filename = `ST_${filenameSafeSender}_${msgId}_${timestamp}`;
      } else {
        filename += `_${new Date().toISOString().replace(/[:.TZ]/g, '-').substring(0,19)}`;
      }
    } catch(e) {
        console.warn("Error generating filename, using fallback.", e);
         filename += `_fallback_${Date.now()}`;
    }
    link.download = `${filename}.png`;
    link.href = dataUrl;
    document.body.appendChild(link); // Firefox need this
    link.click();
    document.body.removeChild(link);
    console.log(`Image downloaded as ${filename}.png`);
}

// Utility to create overlay (same as original)
function createOverlay(message) {
     // 清理任何残留
     document.querySelectorAll('.st-capture-overlay').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'st-capture-overlay';
    const statusBox = document.createElement('div');
    statusBox.className = 'st-capture-status';
    const messageP = document.createElement('p');
    messageP.textContent = message;
    statusBox.appendChild(messageP);
    const progressContainer = document.createElement('div');
    progressContainer.className = 'st-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'st-progress-bar';
    progressBar.style.width = '0%';
    progressContainer.appendChild(progressBar);
    statusBox.appendChild(progressContainer);
    overlay.appendChild(statusBox);
    return overlay;
}

// Utility to update overlay (same as original)
function updateOverlay(overlay, message, progressRatio) {
    if (!overlay || !overlay.parentNode) return;
    const messageP = overlay.querySelector('.st-capture-status p');
    const progressBar = overlay.querySelector('.st-progress-bar');
    if (messageP && message) messageP.textContent = message;
    if (progressBar && typeof progressRatio === 'number') {
       const safeProgress = Math.max(0, Math.min(1, progressRatio));
       progressBar.style.width = `${Math.round(safeProgress * 100)}%`;
    }
}
// 统一移除Overlay
function removeOverlay(overlay, delayMs, finalMessage = null) {
     if (!overlay || !overlay.parentNode) return;
      if(finalMessage){
         updateOverlay(overlay, finalMessage, 1);
      }
     setTimeout(() => {
        if (overlay.parentNode) {
             overlay.parentNode.removeChild(overlay);
         }
     }, delayMs > 0 ? delayMs : 100);
}


// 自定义设置弹窗 
// 关键修改： 更新标签，移除 useForeignObjectRendering
function showSettingsPopup() {
    const settings = getPluginSettings();
     // 清理旧弹窗
     $('.st-settings-overlay').remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'st-settings-overlay';
     Object.assign(overlay.style, { position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', zIndex: '10000', display: 'flex', justifyContent: 'center', maxHeight:'90vh', alignItems:'center', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)'});


    const popup = document.createElement('div');
    popup.className = 'st-settings-popup';
    const bgColor = getComputedStyle(document.body).getPropertyValue('--SmartThemeBlurTintColor') || '#2a2a2a';
    const boxBorderColor = getComputedStyle(document.body).getPropertyValue('--SmartThemeBorderColor') || '#555';
    Object.assign(popup.style, { 
        backgroundColor: bgColor.trim(), 
        border: `1px solid ${boxBorderColor.trim()}`,
        padding: '25px', 
        borderRadius: '10px', 
        maxWidth: '400px', 
        width: '90%', 
        maxHeight: '80vh', 
        overflowY: 'auto',
        boxShadow: '0 5px 15px rgba(0,0,0,0.5)'
    });
    
    const title = document.createElement('h3');
    title.textContent = `${PLUGIN_NAME} 设置`; // 更新标题
    Object.assign(title.style, { marginTop: '0', marginBottom: '20px', textAlign: 'center', borderBottom: `1px solid ${boxBorderColor}`, paddingBottom: '10px' });
    popup.appendChild(title);
    
     // 关键修改：标签，移除 ForeignObject
    const settingsConfig = [
        { id: 'screenshotDelay', type: 'number', label: '截图前延迟 (ms)', min: 0, max: 2000, step: 50 },
        { id: 'screenshotScale', type: 'number', label: '渲染像素比 (PixelRatio)', min: 0.5, max: 4.0, step: 0.1 }, // 改标签
        { id: 'imageTimeout', type: 'number', label: '图像加载超时 (ms)', min: 0, max: 30000, step: 1000 },
       // { id: 'useForeignObjectRendering', type: 'checkbox', label: '尝试SVG对象渲染' }, // 移除此项
        { id: 'cacheBust', type: 'checkbox', label: '清除图片缓存 (CORS)' },
        { id: 'debugOverlay', type: 'checkbox', label: '显示处理进度条' },
        { id: 'autoInstallButtons', type: 'checkbox', label: '自动添加消息按钮' },
    ];
    
    settingsConfig.forEach(setting => {
        const settingContainer = document.createElement('div');
        Object.assign(settingContainer.style, { margin: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' });
        
        const label = document.createElement('label');
        label.textContent = setting.label;
        label.htmlFor = `st_setting_popup_${setting.id}`;
        label.style.flexGrow = '1';
        settingContainer.appendChild(label);
        
        let input;
         input = document.createElement('input');
         input.id = `st_setting_popup_${setting.id}`; 
        if (setting.type === 'checkbox') {
            input.type = 'checkbox';
            input.checked = settings[setting.id];
             input.classList.add('checkbox_toggle'); // 使用ST的checkbox样式
        } else if (setting.type === 'number') {
            input.type = 'number';
            input.min = setting.min;
            input.max = setting.max;
            input.step = setting.step;
            input.value = settings[setting.id];
            input.style.width = '90px';
             input.classList.add('text_pole');
        }
         if(input) settingContainer.appendChild(input);
        popup.appendChild(settingContainer);
    });
    
    const buttonContainer = document.createElement('div');
    Object.assign(buttonContainer.style, { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px', paddingTop: '10px', borderTop: `1px solid ${boxBorderColor}` });
    
     const closeButton = document.createElement('button');
     closeButton.textContent = '关闭';
     closeButton.className = 'menu_button';
      closeButton.onclick = () =>  document.body.removeChild(overlay);
      buttonContainer.appendChild(closeButton);

    const saveButton = document.createElement('button');
    saveButton.textContent = '保存并应用';
     saveButton.className = 'menu_button';
     saveButton.style.backgroundColor = '#4CAF50'; // 突出保存按钮

    saveButton.addEventListener('click', () => {
        const currentSettings = getPluginSettings();
        settingsConfig.forEach(setting => {
            const input = document.getElementById(`st_setting_popup_${setting.id}`);
            if(!input) return;
            if (setting.type === 'checkbox') {
                currentSettings[setting.id] = input.checked;
            } else if (setting.type === 'number'){
                 const parser = setting.id === 'screenshotScale' ? parseFloat : parseInt;
                 const v = parser(input.value);
                 currentSettings[setting.id] = isNaN(v) ? defaultSettings[setting.id] : v;
            }
        });
         // 保存并重新加载配置
        saveSettingsDebounced();
        loadConfig(); 

        // 重新安装或移除按钮
        document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
        if (currentSettings.autoInstallButtons) {
             installScreenshotButtons();
         } else if(messageObserver) {
              messageObserver.disconnect(); // 停止观察
              messageObserver = null;
         }

        document.body.removeChild(overlay);

        if (window.toastr && typeof toastr.success === 'function') {
            toastr.success('截图设置已成功保存并应用！');
        } else {
            alert('截图设置已成功保存并应用！');
        }
    });
    
    buttonContainer.appendChild(saveButton);
    popup.appendChild(buttonContainer);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
     // 点击overlay空白处关闭
     overlay.addEventListener('click', (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
}
--- END OF FILE index.js ---
