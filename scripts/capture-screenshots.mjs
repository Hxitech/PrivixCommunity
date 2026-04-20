#!/usr/bin/env node
/**
 * 自动截图脚本 — 批量截取所有页面用于官网展示
 * Usage: node scripts/capture-screenshots.mjs
 */
import { chromium } from 'playwright';
import path from 'path';

const BASE = process.env.SCREENSHOT_BASE_URL || 'http://localhost:1420';
const OUT = process.env.SCREENSHOT_OUT_DIR || './screenshots';
const PASSWORD = process.env.SCREENSHOT_PASSWORD || '123456';

// 注意: 投资子页面的路由名不带 "invest-" 前缀
const PAGES = [
  { hash: '#/overview', file: 'desktop-overview.png', wait: 2000 },
  { hash: '#/dashboard', file: 'desktop-dashboard.png', wait: 2000 },
  { hash: '#/companies', file: 'desktop-company-database.png', wait: 2000 },
  { hash: '#/contacts', file: 'desktop-contact.png', wait: 2000 },
  { hash: '#/automation', file: 'desktop-automation-center.png', wait: 2000 },
  { hash: '#/scoring', file: 'desktop-scoring.png', wait: 2000 },
  { hash: '#/pipeline', file: 'desktop-project-pipelines.png', wait: 2000 },
  { hash: '#/assistant', file: 'desktop-claw-assistant.png', wait: 2000, mockAssistant: true },
  { hash: '#/agents', file: 'desktop-agent-management.png', wait: 1500 },
  { hash: '#/models', file: 'desktop-model-configuration.png', wait: 1500 },
  { hash: '#/skills', file: 'desktop-skills.png', wait: 1500 },
  { hash: '#/clawswarm', file: 'desktop-clawswarm.png', wait: 2500 },
  { hash: '#/h/dashboard', file: 'desktop-hermes-dashboard.png', wait: 2500, mockHermesDash: true },
  { hash: '#/plugin-hub', file: 'desktop-plugin-hub.png', wait: 1500 },
  { hash: '#/quick-setup', file: 'desktop-quick-setup.png', wait: 1500 },
  { hash: '#/gateway', file: 'desktop-gateway.png', wait: 1500 },
  { hash: '#/star-office', file: 'desktop-star-office.png', wait: 1500 },
  { hash: '#/services', file: 'desktop-services.png', wait: 1000 },
  { hash: '#/memory', file: 'desktop-memory-panel.png', wait: 1000 },
  { hash: '#/cron', file: 'desktop-cron.png', wait: 1000 },
  { hash: '#/about', file: 'desktop-about.png', wait: 1000 },
  { hash: '#/sop', file: 'desktop-sop.png', wait: 1000 },
  { hash: '#/sessions', file: 'desktop-sessions-multi-agent.png', wait: 1000 },
];

// 钳子助手 Mock 对话内容
const ASSISTANT_MOCK_HTML = `
<div class="assistant-messages" style="padding: 24px; max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px;">
  <!-- 用户消息 1 -->
  <div style="display: flex; justify-content: flex-end;">
    <div style="background: #0071e3; color: #fff; padding: 12px 18px; border-radius: 18px 18px 4px 18px; max-width: 70%; font-size: 15px; line-height: 1.5;">
      帮我分析一下目前投资管道中处于尽调阶段的项目，哪些风险较高需要重点关注？
    </div>
  </div>
  <!-- AI 回复 1 -->
  <div style="display: flex; justify-content: flex-start; gap: 10px;">
    <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #ff6b35, #e84118); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 14px; flex-shrink: 0;">🦞</div>
    <div style="background: var(--card-bg, #f0f0f5); padding: 16px 18px; border-radius: 4px 18px 18px 18px; max-width: 75%; font-size: 15px; line-height: 1.6; color: var(--text-color, #1d1d1f);">
      <p style="margin: 0 0 12px 0; font-weight: 600;">📊 尽调阶段项目风险分析</p>
      <p style="margin: 0 0 10px 0;">根据当前投资管道数据，共有 <strong>4 个项目</strong>处于尽调阶段。以下是风险评估：</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 10px 0;">
        <thead>
          <tr style="background: rgba(0,0,0,0.05);">
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(0,0,0,0.1);">项目</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(0,0,0,0.1);">行业</th>
            <th style="padding: 8px; text-align: center; border-bottom: 1px solid rgba(0,0,0,0.1);">风险评级</th>
            <th style="padding: 8px; text-align: left; border-bottom: 1px solid rgba(0,0,0,0.1);">关注点</th>
          </tr>
        </thead>
        <tbody>
          <tr><td style="padding: 8px;">天衡智芯</td><td style="padding: 8px;">半导体</td><td style="padding: 8px; text-align: center;"><span style="color: #e84118;">⚠️ 高</span></td><td style="padding: 8px;">供应链集中度超 70%</td></tr>
          <tr><td style="padding: 8px;">瑞格生物</td><td style="padding: 8px;">医疗健康</td><td style="padding: 8px; text-align: center;"><span style="color: #f0a500;">🔶 中</span></td><td style="padding: 8px;">临床 III 期延迟 2 个月</td></tr>
          <tr><td style="padding: 8px;">云途物联</td><td style="padding: 8px;">IoT</td><td style="padding: 8px; text-align: center;"><span style="color: #44bd32;">✅ 低</span></td><td style="padding: 8px;">财务指标达标</td></tr>
          <tr><td style="padding: 8px;">数盈科技</td><td style="padding: 8px;">企业服务</td><td style="padding: 8px; text-align: center;"><span style="color: #e84118;">⚠️ 高</span></td><td style="padding: 8px;">核心团队离职率 25%</td></tr>
        </tbody>
      </table>
      <p style="margin: 10px 0 0 0;"><strong>建议：</strong>天衡智芯和数盈科技需要尽快安排专项风险评审会，建议本周内完成补充材料收集。</p>
    </div>
  </div>
  <!-- 用户消息 2 -->
  <div style="display: flex; justify-content: flex-end;">
    <div style="background: #0071e3; color: #fff; padding: 12px 18px; border-radius: 18px 18px 4px 18px; max-width: 70%; font-size: 15px; line-height: 1.5;">
      天衡智芯的供应链集中度问题，有什么缓解方案吗？
    </div>
  </div>
  <!-- AI 回复 2 -->
  <div style="display: flex; justify-content: flex-start; gap: 10px;">
    <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #ff6b35, #e84118); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 14px; flex-shrink: 0;">🦞</div>
    <div style="background: var(--card-bg, #f0f0f5); padding: 16px 18px; border-radius: 4px 18px 18px 18px; max-width: 75%; font-size: 15px; line-height: 1.6; color: var(--text-color, #1d1d1f);">
      <p style="margin: 0 0 10px 0;">针对天衡智芯的供应链集中风险，建议从三个维度制定缓解方案：</p>
      <p style="margin: 0 0 6px 0;"><strong>1. 短期（1-3 个月）</strong>：要求管理层提供备选供应商清单及切换成本评估，纳入投决条件</p>
      <p style="margin: 0 0 6px 0;"><strong>2. 中期（3-6 个月）</strong>：在条款中增加供应链多元化的里程碑对赌，与下一轮估值挂钩</p>
      <p style="margin: 0 0 6px 0;"><strong>3. 长期</strong>：协助对接产业链资源，推动建立至少 2 家以上合格供应商</p>
      <p style="margin: 10px 0 0 0; padding: 10px; background: rgba(0,113,227,0.06); border-radius: 8px; font-size: 13px;">💡 <em>我已将此风险分析同步至天衡智芯的项目备忘录。你可以在「投资管理 → 项目池」中查看完整报告。</em></p>
    </div>
  </div>
</div>
`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // Retina
  });
  const page = await context.newPage();

  // 1. 登录前设置
  console.log('Setting up...');
  await page.goto(BASE);
  await page.waitForTimeout(1000);

  // 预设主题/语言
  await page.evaluate(() => {
    localStorage.setItem('privix-community-theme-preset', 'light');
    localStorage.setItem('privix-community-locale', 'zh-CN');
    localStorage.setItem('privix_community_welcomed', '1');
    localStorage.setItem('welcome_modal_dismissed', '1');
    // 清除遗留的 flyout 偏好(v1.4.1 已废弃,侧边栏改为 9 主线 pillars)
    localStorage.removeItem('privix-community-nav-mode');
    sessionStorage.removeItem('privix_community_must_change_pw');
    sessionStorage.removeItem('clawpanel_must_change_pw');
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await page.reload();
  await page.waitForTimeout(2000);

  // 2. 登录
  console.log('Logging in...');
  const pwInput = page.locator('input').first();
  await pwInput.fill(PASSWORD);
  await page.locator('.login-card button, .login-form button, form button, button').first().click();
  await page.waitForTimeout(3000);

  // 3. 登录后清理
  await page.evaluate(() => {
    sessionStorage.removeItem('privix_community_must_change_pw');
    sessionStorage.removeItem('clawpanel_must_change_pw');
    document.getElementById('pw-change-banner')?.remove();
    document.documentElement.setAttribute('data-theme', 'light');
    const style = document.createElement('style');
    style.id = 'screenshot-cleanup';
    style.textContent = `
      #pw-change-banner, [class*="fab"], [class*="toast"],
      .global-banner, .help-fab, .fab-container { display: none !important; }
    `;
    document.head.appendChild(style);
    document.querySelectorAll('[class*="modal"], [class*="overlay"], [class*="welcome"]').forEach(el => {
      if (el.id !== 'login-overlay') el.remove();
    });
  });

  // 4a. 强制 active engine = openclaw(避免 Hermes 路由守卫把所有路由吞到 /h/dashboard)
  console.log('Forcing engine = openclaw...');
  const forceResp = await page.evaluate(async () => {
    try {
      const r1 = await fetch('/__api/read_panel_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const cfg = (await r1.json()) || {};
      cfg.engineMode = 'openclaw';
      const r2 = await fetch('/__api/write_panel_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg })
      });
      return { readOk: r1.ok, writeOk: r2.ok, cfg };
    } catch (e) { return { error: String(e) }; }
  });
  console.log('  force engine result:', JSON.stringify(forceResp));
  // reload 让 initEngineManager 读到新 engineMode
  await page.reload();
  await page.waitForTimeout(2500);

  // 4b. 导入演示数据（为投资页面准备内容）
  console.log('Importing demo data...');
  try {
    const resp = await page.evaluate(async () => {
      try {
        const r = await fetch('/__api/import_demo_data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        return { status: r.status, ok: r.ok };
      } catch (e) {
        return { error: e.message };
      }
    });
    console.log('  Demo data import:', JSON.stringify(resp));
  } catch (e) {
    console.log('  Demo data import skipped:', e.message);
  }
  await page.waitForTimeout(1000);

  // 5. 逐页截图 — 按 engine 分组:先跑 OpenClaw 路由,最后切 Hermes 跑 /h/ 路由
  const sortedPages = [...PAGES].sort((a, b) => {
    const aHermes = a.hash.startsWith('#/h/') ? 1 : 0;
    const bHermes = b.hash.startsWith('#/h/') ? 1 : 0;
    return aHermes - bHermes;
  });
  let currentEngineMode = 'openclaw';
  async function setEngineMode(mode) {
    if (mode === currentEngineMode) return;
    console.log(`  ↺ Switching engine to ${mode}...`);
    await page.evaluate(async (m) => {
      const r = await fetch('/__api/read_panel_config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const cfg = (await r.json()) || {};
      cfg.engineMode = m;
      await fetch('/__api/write_panel_config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg })
      });
    }, mode);
    await page.reload();
    await page.waitForTimeout(2500);
    currentEngineMode = mode;
  }

  for (const { hash, file, wait, mockAssistant, mockHermesDash } of sortedPages) {
    const needsHermes = hash.startsWith('#/h/');
    await setEngineMode(needsHermes ? 'hermes' : 'openclaw');
    console.log(`  Capturing ${hash} → ${file}`);

    // 用 goto 导航（比设 hash 更可靠）
    await page.goto(`${BASE}/${hash}`, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {
      // 如果 networkidle 超时，降级到 load
      return page.goto(`${BASE}/${hash}`, { waitUntil: 'load', timeout: 5000 });
    });
    await page.waitForTimeout(wait);

    // 检查是否被重定向到 invest-repair
    const currentHash = await page.evaluate(() => window.location.hash);
    if (currentHash.includes('invest-repair')) {
      console.log(`    Redirected to invest-repair, skipping readiness check...`);
      // 跳过 readiness 检查，强制导航
      await page.evaluate((h) => {
        // 临时禁用路由守卫并导航
        window.location.hash = h;
      }, hash);
      await page.waitForTimeout(wait);
    }

    // 清理浮动元素
    await page.evaluate(() => {
      document.querySelectorAll('[class*="banner"], [class*="fab"], [class*="toast"]').forEach(el => el.remove());
      document.querySelectorAll('[class*="modal"], [class*="overlay"], [class*="welcome"]').forEach(el => {
        if (el.id !== 'login-overlay') el.remove();
      });
      document.querySelectorAll('div[style*="position: fixed"][style*="top"]').forEach(el => el.remove());
      document.querySelectorAll('.app-layout > div:first-child').forEach(el => {
        if (el.textContent.includes('密码') || el.textContent.includes('安全')) el.remove();
      });
    });

    // 为钳子助手注入 mock 对话(新 UI 用 #ast-messages 容器)
    if (mockAssistant) {
      console.log('    Injecting mock conversation...');
      await page.evaluate((mockHTML) => {
        // 优先目标:assistant 页面的主消息容器
        const astMessages = document.getElementById('ast-messages');
        if (astMessages) {
          astMessages.innerHTML = mockHTML;
          // 同时隐藏引导页/空状态
          document.getElementById('ast-page-guide')?.remove();
          document.querySelectorAll('.ast-empty').forEach(el => el.remove());
          return;
        }
        // 备用:旧 DOM 兜底
        const mainContent = document.querySelector('.ast-main, .page-content, main, .main-content');
        if (mainContent) {
          const chatArea = mainContent.querySelector('[class*="messages"], [class*="chat-body"]') || mainContent;
          chatArea.innerHTML = mockHTML;
        }
      }, ASSISTANT_MOCK_HTML);
      await page.waitForTimeout(500);
    }

    // Hermes Dashboard fallback:如果 mock 全就绪但仍出现骨架屏/未渲染,
    // 可在此处加 DOM 注入兜底。现阶段只靠 dev-api.js mock 升级,无需额外处理。
    if (mockHermesDash) {
      // 预留位:观察首轮截图,若出现空态再填注入内容
      void mockHermesDash;
    }

    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  }

  // 6. 清理:截图结束后把 engineMode 还原为默认 openclaw(避免给用户留 hermes 状态)
  await setEngineMode('openclaw');

  console.log(`\nDone! ${PAGES.length} screenshots saved to ${OUT}`);
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
