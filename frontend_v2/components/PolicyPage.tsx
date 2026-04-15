import React from 'react';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from '../lib/i18n';

/**
 * Extract a language section from multilingual markdown content.
 * Sections are delimited by ## headers like "## 中文版", "## English Version", etc.
 * Returns content between the matching header and the next ## header (or end of string).
 */
function extractSection(content: string, lang: 'zh' | 'en'): string {
  const sectionHeader = lang === 'zh' ? '## 中文版' : '## English Version';
  const startIdx = content.indexOf(sectionHeader);
  if (startIdx === -1) return content;

  const afterHeader = startIdx + sectionHeader.length;
  // Find the next ## section header
  const nextSection = content.indexOf('\n## ', afterHeader);
  const section = nextSection === -1
    ? content.slice(afterHeader)
    : content.slice(afterHeader, nextSection);

  return section.trim();
}

// --- Embedded policy content (copied from web/src/pages/) ---

const PRIVACY_CONTENT = `## 中文版

# 隐私政策

**最后更新日期：2025年1月1日**

**生效日期：2025年1月1日**

CaMeL API（以下简称"我们"）非常重视您的隐私保护。本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息。请您在使用我们的服务前仔细阅读本政策。

### 1. 信息收集

我们可能收集以下类型的信息：

- **账户信息**：注册时提供的用户名、电子邮箱地址、密码（加密存储）
- **使用数据**：API 调用记录、模型使用情况、请求频率和时间戳
- **支付信息**：充值记录、订阅信息（我们不直接存储您的银行卡或支付账户信息，支付由第三方支付服务商处理）
- **技术信息**：IP 地址、浏览器类型、设备信息、操作系统版本
- **日志数据**：服务器访问日志、错误日志（用于服务优化和故障排查）

### 2. 信息使用

我们收集的信息将用于以下目的：

- 提供、维护和改进我们的服务
- 处理您的交易和管理您的账户
- 发送服务通知和技术支持信息
- 监控和分析使用趋势以优化用户体验
- 防止欺诈和滥用行为
- 遵守法律法规要求

### 3. Cookie 和类似技术

我们使用 Cookie 和类似技术来：

- 维持您的登录状态
- 记住您的偏好设置
- 分析服务使用情况

您可以通过浏览器设置管理 Cookie 偏好，但禁用 Cookie 可能影响部分功能的正常使用。

### 4. 信息共享与第三方

我们不会出售您的个人信息。在以下情况下，我们可能与第三方共享您的信息：

- **服务提供商**：为完成 API 请求，我们需要将您的请求内容转发至相应的 AI 模型提供商（如 OpenAI、Anthropic、Google 等）
- **支付处理**：支付服务商处理您的充值和订阅交易
- **法律要求**：当法律法规要求或政府机关依法请求时
- **安全保护**：为保护我们、用户或公众的权利、财产或安全

### 5. 数据安全

我们采取合理的技术和管理措施保护您的个人信息：

- 数据传输使用 TLS/SSL 加密
- 密码使用行业标准算法加密存储
- 定期进行安全审计和漏洞扫描
- 严格的内部数据访问权限控制

### 6. 儿童隐私

我们的服务不面向 16 周岁以下的未成年人。我们不会故意收集未成年人的个人信息。如果您发现未成年人向我们提供了个人信息，请联系我们，我们将及时删除相关信息。

### 7. 国际数据传输

由于我们聚合了全球多个 AI 模型供应商，您的 API 请求数据可能被传输至其他国家或地区的服务器进行处理。我们会确保此类传输符合适用的数据保护法律。

### 8. 您的权利

根据适用法律，您享有以下权利：

- **访问权**：查看我们持有的您的个人信息
- **更正权**：更正不准确的个人信息
- **删除权**：请求删除您的个人信息
- **数据可携带权**：以结构化格式获取您的数据
- **撤回同意权**：撤回之前给予的同意

如需行使上述权利，请通过以下联系方式与我们联系。

### 9. 数据保留

我们将在实现本政策所述目的所需的期限内保留您的个人信息。当不再需要时，我们将安全地删除或匿名化处理您的信息。API 调用日志默认保留 90 天。

### 10. 政策修改

我们可能不时更新本隐私政策。重大变更将通过网站公告或电子邮件通知您。继续使用我们的服务即表示您接受更新后的政策。

### 11. 联系我们

如果您对本隐私政策有任何疑问或建议，请通过以下方式联系我们：

- **邮箱**：support@kr777.top

---

*本隐私政策的最终解释权归 CaMeL API 所有。*

## English Version

# Privacy Policy

**Last Updated: January 1, 2025**

**Effective Date: January 1, 2025**

CaMeL API (hereinafter referred to as "we" or "us") takes your privacy very seriously. This Privacy Policy explains how we collect, use, store, and protect your personal information. Please read this policy carefully before using our services.

### 1. Information Collection

We may collect the following types of information:

- **Account Information**: Username, email address, and password (encrypted) provided during registration
- **Usage Data**: API call records, model usage, request frequency, and timestamps
- **Payment Information**: Top-up records and subscription information (we do not directly store your bank card or payment account details; payments are processed by third-party payment providers)
- **Technical Information**: IP address, browser type, device information, and operating system version
- **Log Data**: Server access logs and error logs (used for service optimization and troubleshooting)

### 2. Use of Information

The information we collect is used for the following purposes:

- Providing, maintaining, and improving our services
- Processing your transactions and managing your account
- Sending service notifications and technical support information
- Monitoring and analyzing usage trends to optimize user experience
- Preventing fraud and abuse
- Complying with legal and regulatory requirements

### 3. Cookies and Similar Technologies

We use cookies and similar technologies to:

- Maintain your login session
- Remember your preference settings
- Analyze service usage

You can manage cookie preferences through your browser settings, but disabling cookies may affect the normal use of some features.

### 4. Information Sharing and Third Parties

We do not sell your personal information. We may share your information with third parties in the following circumstances:

- **Service Providers**: To fulfill API requests, we need to forward your request content to the corresponding AI model providers (such as OpenAI, Anthropic, Google, etc.)
- **Payment Processing**: Payment service providers process your top-up and subscription transactions
- **Legal Requirements**: When required by laws and regulations or requested by government authorities
- **Security Protection**: To protect the rights, property, or safety of us, users, or the public

### 5. Data Security

We take reasonable technical and administrative measures to protect your personal information:

- Data transmission uses TLS/SSL encryption
- Passwords are encrypted using industry-standard algorithms
- Regular security audits and vulnerability scans
- Strict internal data access controls

### 6. Children's Privacy

Our services are not intended for minors under the age of 16. We do not knowingly collect personal information from minors. If you discover that a minor has provided us with personal information, please contact us and we will promptly delete the relevant information.

### 7. International Data Transfers

As we aggregate multiple global AI model providers, your API request data may be transferred to servers in other countries or regions for processing. We ensure that such transfers comply with applicable data protection laws.

### 8. Your Rights

Subject to applicable law, you have the following rights:

- **Right of Access**: View the personal information we hold about you
- **Right of Rectification**: Correct inaccurate personal information
- **Right of Deletion**: Request deletion of your personal information
- **Right of Data Portability**: Obtain your data in a structured format
- **Right to Withdraw Consent**: Withdraw previously given consent

To exercise these rights, please contact us using the information below.

### 9. Data Retention

We retain your personal information for as long as necessary to fulfill the purposes described in this policy. When no longer needed, we will securely delete or anonymize your information. API call logs are retained for 90 days by default.

### 10. Policy Changes

We may update this Privacy Policy from time to time. Significant changes will be communicated via website announcements or email. Continued use of our services constitutes acceptance of the updated policy.

### 11. Contact Us

If you have any questions or suggestions about this Privacy Policy, please contact us:

- **Email**: support@kr777.top

---

*CaMeL API reserves the right of final interpretation of this Privacy Policy.*`;

const TERMS_CONTENT = `## 中文版

# 用户协议

**最后更新日期：2025年1月1日**

**生效日期：2025年1月1日**

欢迎使用 CaMeL API（以下简称"本平台"或"我们"）。请您在注册和使用本平台服务前，仔细阅读并充分理解本用户协议（以下简称"本协议"）的全部内容。

### 1. 服务说明

CaMeL API 是一个大模型统一接口网关平台，提供以下服务：

- 聚合全球 40+ 主流 AI 模型供应商的 API 接口
- 提供统一的 OpenAI 兼容格式 API
- 用户账户管理、API 密钥管理
- 额度管理、使用统计和计费服务
- 订阅套餐和按量付费服务

### 2. 账户注册与管理

- 您需要注册账户才能使用本平台的核心服务
- 您应提供真实、准确的注册信息
- 您有责任妥善保管账户凭证（密码、API 密钥等），因保管不善导致的损失由您自行承担
- 每位用户仅可注册一个账户，禁止多账户注册以获取不当利益
- 我们保留在发现违规行为时暂停或终止账户的权利

### 3. 使用规范

您在使用本平台服务时，应遵守以下规范：

**禁止行为：**
- 利用本平台从事任何违反法律法规的活动
- 生成、传播违法、有害、威胁、骚扰、诽谤、色情或其他不当内容
- 尝试未经授权访问本平台系统或其他用户的数据
- 对本平台进行逆向工程、反编译或反汇编
- 使用自动化工具恶意攻击或滥用本平台服务
- 转售或未经授权分享 API 访问权限
- 规避本平台的速率限制或安全措施

### 4. 知识产权

- 本平台的软件、界面设计、商标、标识等知识产权归我们所有
- 您通过 API 生成的内容，其知识产权归属遵循相应 AI 模型提供商的条款
- 您不得复制、修改、分发本平台的任何专有内容

### 5. 计费与支付

- 本平台提供按量付费和订阅套餐两种计费方式
- 充值金额将转换为平台额度，用于支付 API 调用费用
- 各模型的调用价格以平台公示的价格表为准，我们保留调整价格的权利
- 已充值的额度不支持退款，特殊情况请联系客服处理
- 订阅套餐的额度按周期重置，未使用的额度不累计至下一周期

### 6. 隐私保护

我们重视您的隐私保护，具体请参阅我们的《隐私政策》。使用本平台即表示您同意我们按照隐私政策收集和使用您的信息。

### 7. 免责声明

- 本平台作为 API 网关，不对第三方 AI 模型生成的内容承担责任
- 我们不保证服务的不间断性或无错误性，但会尽最大努力保障服务稳定
- 因不可抗力（包括但不限于自然灾害、网络故障、政策变化）导致的服务中断，我们不承担责任
- 因上游 AI 模型供应商的服务变更或中断导致的影响，我们不承担责任
- 本平台不对因用户违规使用导致的任何损失承担责任

### 8. 赔偿限制

在法律允许的最大范围内，我们对因使用或无法使用本平台服务而产生的任何间接、附带、特殊或后果性损害不承担责任。我们的最大赔偿责任不超过您在争议发生前 12 个月内向本平台支付的总金额。

### 9. 服务终止

- 您可以随时注销账户并停止使用本平台服务
- 我们保留因违反本协议而暂停或终止您账户的权利
- 账户终止后，我们将按照隐私政策处理您的数据
- 账户终止不影响终止前已产生的权利和义务

### 10. 适用法律与争议解决

- 本协议的订立、执行和解释适用中华人民共和国法律
- 因本协议引起的争议，双方应首先友好协商解决
- 协商不成的，任何一方均可向本平台所在地有管辖权的人民法院提起诉讼

### 11. 协议修改

我们保留随时修改本协议的权利。修改后的协议将在本平台上公布，重大变更将通过网站公告或电子邮件通知您。继续使用本平台服务即表示您接受修改后的协议。

### 12. 联系我们

如果您对本协议有任何疑问或建议，请通过以下方式联系我们：

- **邮箱**：support@kr777.top

---

*本用户协议的最终解释权归 CaMeL API 所有。*

## English Version

# User Agreement

**Last Updated: January 1, 2025**

**Effective Date: January 1, 2025**

Welcome to CaMeL API (hereinafter referred to as "the Platform" or "we"). Please carefully read and fully understand this User Agreement (hereinafter referred to as "this Agreement") before registering and using our services.

### 1. Service Description

CaMeL API is a unified LLM gateway platform that provides the following services:

- Aggregated API access to 40+ mainstream global AI model providers
- Unified OpenAI-compatible API format
- User account management and API key management
- Quota management, usage statistics, and billing services
- Subscription plans and pay-as-you-go billing

### 2. Account Registration and Management

- You must register an account to use the core services of this Platform
- You should provide truthful and accurate registration information
- You are responsible for safeguarding your account credentials (passwords, API keys, etc.); losses due to poor safekeeping are your own responsibility
- Each user may only register one account; multiple account registration for improper benefits is prohibited
- We reserve the right to suspend or terminate accounts upon discovery of violations

### 3. Usage Guidelines

When using this Platform's services, you must comply with the following guidelines:

**Prohibited Activities:**
- Using this Platform for any activities that violate laws and regulations
- Generating or distributing illegal, harmful, threatening, harassing, defamatory, pornographic, or other inappropriate content
- Attempting unauthorized access to this Platform's systems or other users' data
- Reverse engineering, decompiling, or disassembling this Platform
- Using automated tools to maliciously attack or abuse this Platform's services
- Reselling or sharing API access without authorization
- Circumventing this Platform's rate limits or security measures

### 4. Intellectual Property

- The software, interface design, trademarks, and logos of this Platform are our intellectual property
- The intellectual property of content generated through the API is subject to the terms of the respective AI model providers
- You may not copy, modify, or distribute any proprietary content of this Platform

### 5. Billing and Payment

- This Platform offers both pay-as-you-go and subscription billing methods
- Top-up amounts are converted to platform credits for paying API call fees
- Model call prices are based on the price list published on the Platform; we reserve the right to adjust prices
- Recharged credits are non-refundable; for special circumstances, please contact customer service
- Subscription plan credits reset per cycle; unused credits do not carry over to the next cycle

### 6. Privacy Protection

We value your privacy. Please refer to our Privacy Policy for details. Using this Platform constitutes your consent to our collection and use of your information in accordance with the Privacy Policy.

### 7. Disclaimer

- As an API gateway, this Platform is not responsible for content generated by third-party AI models
- We do not guarantee uninterrupted or error-free service, but will make every effort to ensure service stability
- We are not liable for service interruptions caused by force majeure (including but not limited to natural disasters, network failures, policy changes)
- We are not liable for impacts caused by upstream AI model provider service changes or interruptions
- This Platform is not responsible for any losses resulting from users' violations of usage guidelines

### 8. Limitation of Liability

To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, or consequential damages arising from the use or inability to use this Platform's services. Our maximum liability shall not exceed the total amount you paid to this Platform in the 12 months preceding the dispute.

### 9. Service Termination

- You may cancel your account and stop using this Platform's services at any time
- We reserve the right to suspend or terminate your account for violations of this Agreement
- After account termination, we will handle your data in accordance with the Privacy Policy
- Account termination does not affect rights and obligations that arose prior to termination

### 10. Governing Law and Dispute Resolution

- This Agreement is governed by the laws of the People's Republic of China
- Disputes arising from this Agreement shall first be resolved through friendly negotiation
- If negotiation fails, either party may file a lawsuit with the competent court in the jurisdiction where this Platform is located

### 11. Agreement Modifications

We reserve the right to modify this Agreement at any time. The modified Agreement will be published on this Platform, and significant changes will be communicated via website announcements or email. Continued use of this Platform's services constitutes acceptance of the modified Agreement.

### 12. Contact Us

If you have any questions or suggestions about this Agreement, please contact us:

- **Email**: support@kr777.top

---

*CaMeL API reserves the right of final interpretation of this User Agreement.*`;

const REFUND_CONTENT = `## 中文版

# 退款政策

**最后更新日期：2025年1月1日**

**生效日期：2025年1月1日**

CaMeL API（以下简称"我们"）提供基于 API 的人工智能模型接入服务。本退款政策旨在向您说明我们的退款规则和订阅取消流程。

### 1. 服务性质

我们提供的是数字服务，具有以下特点：

- **即时交付**：注册后即时获得 API 密钥，充值后额度立即生效
- **按量消费**：API 调用按实际使用量计费
- **不可逆性**：已消费的 API 额度无法恢复

### 2. 退款政策

由于数字服务的即时交付特性：

- **充值额度**：充值成功后，额度即时到账并可立即使用，已交付的数字服务不支持退款
- **未使用额度**：未使用的充值额度不予退款，不可转让，不可结转至其他账户
- **订阅套餐**：订阅生效后不支持退款，当前计费周期内的剩余额度不予退款

### 3. 订阅取消

- 您可以随时在账户设置中取消订阅
- 取消后，当前计费周期内的服务继续有效，直至周期结束
- 周期结束后将停止自动续费，不再产生新的费用
- 取消订阅不会触发退款

### 4. 例外情况

以下情况我们将酌情处理退款：

- **服务故障**：因我们的技术故障导致服务完全不可用超过 24 小时
- **重复扣款**：因支付系统错误导致的重复收费
- **计费错误**：可证实的计费系统错误导致的多收费用

### 5. 争议处理

如您对账单有异议：

1. 请在交易发生后 30 天内联系我们
2. 提供订单号、交易时间和争议说明
3. 我们将在 5 个工作日内调查并回复
4. 如确认存在错误，退款将在 5-10 个工作日内原路返回

### 6. 联系我们

如有退款相关问题，请联系：

- **邮箱**：support@kr777.top

---

*本退款政策的最终解释权归 CaMeL API 所有。*

## English Version

# Refund Policy

**Last Updated: January 1, 2025**

**Effective Date: January 1, 2025**

CaMeL API (hereinafter referred to as "we" or "us") provides API-based artificial intelligence model access services. This Refund Policy explains our refund rules and subscription cancellation procedures.

### 1. Nature of Service

We provide digital services with the following characteristics:

- **Instant Delivery**: API keys are issued immediately upon registration; credits become available instantly after payment
- **Usage-Based Billing**: API calls are billed based on actual usage
- **Irreversibility**: Consumed API credits cannot be restored

### 2. Refund Policy

Due to the instant delivery nature of digital services:

- **Top-Up Credits**: Credits are delivered instantly upon successful payment and are available for immediate use. Delivered digital services are non-refundable
- **Unused Credits**: Unused credits are non-refundable, non-transferable, and cannot be carried over to other accounts
- **Subscription Plans**: Subscriptions are non-refundable once activated. Remaining credits within the current billing cycle are not refundable

### 3. Subscription Cancellation

- You may cancel your subscription at any time from your account settings
- After cancellation, services remain active until the end of the current billing cycle
- Automatic renewal will stop at the end of the cycle, and no further charges will be incurred
- Cancellation does not trigger a refund

### 4. Exceptions

We will consider refunds in the following circumstances:

- **Service Outage**: Complete service unavailability for more than 24 hours due to our technical failure
- **Duplicate Charges**: Duplicate billing caused by payment system errors
- **Billing Errors**: Verifiable overcharges caused by billing system errors

### 5. Dispute Resolution

If you have a billing dispute:

1. Contact us within 30 days of the transaction
2. Provide the order number, transaction time, and dispute description
3. We will investigate and respond within 5 business days
4. If an error is confirmed, refunds will be processed to the original payment method within 5-10 business days

### 6. Contact Us

For refund-related inquiries, please contact:

- **Email**: support@kr777.top

---

*CaMeL API reserves the right of final interpretation of this Refund Policy.*`;

const POLICY_CONFIG = {
  privacy: { content: PRIVACY_CONTENT, zh: '隐私政策', en: 'Privacy Policy' },
  terms: { content: TERMS_CONTENT, zh: '用户协议', en: 'Terms of Service' },
  refund: { content: REFUND_CONTENT, zh: '退款政策', en: 'Refund Policy' },
} as const;

interface PolicyPageProps {
  type: keyof typeof POLICY_CONFIG;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onBack: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onPricing: () => void;
  onPrivacy: () => void;
  onTerms: () => void;
  onRefund: () => void;
}

const PolicyPage: React.FC<PolicyPageProps> = ({ type, theme, toggleTheme, onBack, onLogin, onRegister, onPricing, onPrivacy, onTerms, onRefund }) => {
  const { t, language, setLanguage } = useTranslation();
  const config = POLICY_CONFIG[type];
  const markdown = extractSection(config.content, language);

  return (
    <div className="min-h-screen bg-[#f6f8fb] dark:bg-[#0b1220] text-slate-900 dark:text-slate-100" style={{ fontFamily: '"Space Grotesk","Inter",sans-serif' }}>
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/85 dark:bg-[#0b1220]/80 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-[20px]">hub</span>
            </div>
            <div>
              <div className="font-bold leading-none">CaMeL AI</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">CaMeL AI Platform</div>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onPricing} className="px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              {t('public.pricing')}
            </button>
            <button onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              {language === 'zh' ? 'EN' : '中文'}
            </button>
            <button onClick={toggleTheme} className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button onClick={onLogin} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
              {t('public.login')}
            </button>
            <button onClick={onRegister} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors">
              {t('public.register')}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-black mb-8">{language === 'zh' ? config.zh : config.en}</h1>
        <div className="prose dark:prose-invert max-w-none bg-white dark:bg-[#0f1a2b] rounded-2xl border border-slate-200 dark:border-slate-800 p-8">
          <ReactMarkdown>{markdown}</ReactMarkdown>
        </div>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-[#0b1220]/50">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-slate-400">&copy; {new Date().getFullYear()} CaMeL AI</span>
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>联系邮箱: <a href="mailto:support@kr777.top" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">support@kr777.top</a></span>
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span>QQ群号: 1080898797</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <button onClick={onPrivacy} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('public.footer.privacy')}</button>
            <button onClick={onTerms} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('public.footer.terms')}</button>
            <button onClick={onRefund} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('public.footer.refund')}</button>
            <button onClick={onPricing} className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">{t('public.footer.pricing')}</button>
          </div>
        </div>
        <div className="text-center pb-4 text-xs text-slate-400 dark:text-slate-500">
          沪ICP备2022024740号-4
        </div>
      </footer>
    </div>
  );
};

export default PolicyPage;
