/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React from 'react';
import { useTranslation } from 'react-i18next';
import DocumentRenderer from '../../components/common/DocumentRenderer';

const multiLangContent = `## 中文版

# 用户协议

**最后更新日期：2025年1月1日**

**生效日期：2025年1月1日**

欢迎使用 AllModels（以下简称"本平台"或"我们"）。请您在注册和使用本平台服务前，仔细阅读并充分理解本用户协议（以下简称"本协议"）的全部内容。

### 1. 服务说明

AllModels 是一个大模型统一接口网关平台，提供以下服务：

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

*本用户协议的最终解释权归 AllModels 所有。*

---

## English Version

# User Agreement

**Last Updated: January 1, 2025**

**Effective Date: January 1, 2025**

Welcome to AllModels (hereinafter referred to as "the Platform" or "we"). Please carefully read and fully understand this User Agreement (hereinafter referred to as "this Agreement") before registering and using our services.

### 1. Service Description

AllModels is a unified LLM gateway platform that provides the following services:

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

*AllModels reserves the right of final interpretation of this User Agreement.*

---

## 日本語版

# 利用規約

**最終更新日：2025年1月1日**

**発効日：2025年1月1日**

AllModels（以下「本プラットフォーム」または「当社」）へようこそ。本プラットフォームのサービスに登録・利用する前に、本利用規約（以下「本規約」）の全内容をよくお読みいただき、十分にご理解ください。

### 1. サービス説明

AllModelsは、以下のサービスを提供する統合LLMゲートウェイプラットフォームです：

- 世界40以上の主要AIモデルプロバイダーのAPI統合アクセス
- 統一されたOpenAI互換APIフォーマット
- ユーザーアカウント管理、APIキー管理
- クォータ管理、利用統計、課金サービス
- サブスクリプションプランと従量課金

### 2. アカウント登録と管理

- 本プラットフォームのコアサービスを利用するにはアカウント登録が必要です
- 真実かつ正確な登録情報を提供してください
- アカウント認証情報（パスワード、APIキーなど）の適切な管理はお客様の責任です。管理不備による損失はお客様の自己責任となります
- 各ユーザーは1つのアカウントのみ登録可能です。不正な利益を得るための複数アカウント登録は禁止されています
- 当社は違反行為を発見した場合、アカウントを一時停止または終了する権利を留保します

### 3. 利用規範

本プラットフォームのサービスを利用する際は、以下の規範を遵守してください：

**禁止行為：**
- 本プラットフォームを利用した法令違反行為
- 違法、有害、脅迫的、嫌がらせ、名誉毀損、わいせつ、その他不適切なコンテンツの生成・配布
- 本プラットフォームのシステムまたは他のユーザーのデータへの不正アクセスの試み
- 本プラットフォームのリバースエンジニアリング、逆コンパイル、逆アセンブル
- 自動化ツールを使用した本プラットフォームサービスへの悪意ある攻撃や悪用
- APIアクセス権限の無断転売または共有
- 本プラットフォームのレート制限やセキュリティ対策の回避

### 4. 知的財産権

- 本プラットフォームのソフトウェア、インターフェースデザイン、商標、ロゴなどの知的財産権は当社に帰属します
- APIを通じて生成されたコンテンツの知的財産権は、各AIモデルプロバイダーの規約に従います
- 本プラットフォームの専有コンテンツの複製、改変、配布は禁止されています

### 5. 課金と支払い

- 本プラットフォームは従量課金とサブスクリプションの2つの課金方式を提供しています
- チャージ金額はプラットフォームクレジットに変換され、API呼び出し料金の支払いに使用されます
- 各モデルの呼び出し価格はプラットフォームに公示された価格表に基づきます。当社は価格を調整する権利を留保します
- チャージ済みのクレジットは返金不可です。特別な事情がある場合はカスタマーサービスにお問い合わせください
- サブスクリプションプランのクレジットは周期ごとにリセットされ、未使用のクレジットは次の周期に繰り越されません

### 6. プライバシー保護

当社はお客様のプライバシー保護を重視しています。詳細は当社のプライバシーポリシーをご参照ください。本プラットフォームの利用は、プライバシーポリシーに従った情報の収集・使用への同意を意味します。

### 7. 免責事項

- 本プラットフォームはAPIゲートウェイとして、第三者AIモデルが生成したコンテンツについて責任を負いません
- サービスの中断やエラーがないことを保証するものではありませんが、サービスの安定性確保に最善を尽くします
- 不可抗力（自然災害、ネットワーク障害、政策変更を含むがこれに限定されない）によるサービス中断について、当社は責任を負いません
- 上流AIモデルプロバイダーのサービス変更や中断による影響について、当社は責任を負いません
- ユーザーの規約違反による損失について、本プラットフォームは責任を負いません

### 8. 賠償制限

法律で許容される最大限の範囲において、本プラットフォームサービスの使用または使用不能から生じる間接的、付随的、特別、または結果的損害について、当社は責任を負いません。当社の最大賠償責任は、紛争発生前12ヶ月間にお客様が本プラットフォームに支払った総額を超えないものとします。

### 9. サービスの終了

- お客様はいつでもアカウントを解約し、本プラットフォームサービスの利用を停止できます
- 当社は本規約違反によりアカウントを一時停止または終了する権利を留保します
- アカウント終了後、お客様のデータはプライバシーポリシーに従って処理されます
- アカウント終了は、終了前に発生した権利義務に影響しません

### 10. 準拠法と紛争解決

- 本規約の締結、履行、解釈は中華人民共和国の法律に準拠します
- 本規約に起因する紛争は、まず友好的な協議により解決するものとします
- 協議が不調の場合、いずれの当事者も本プラットフォーム所在地の管轄裁判所に訴訟を提起できます

### 11. 規約の変更

当社は本規約をいつでも変更する権利を留保します。変更後の規約は本プラットフォーム上で公開され、重大な変更はウェブサイトの告知またはメールでお知らせします。本プラットフォームサービスの継続利用は、変更後の規約への同意を意味します。

### 12. お問い合わせ

本規約に関するご質問やご提案がございましたら、以下の方法でお問い合わせください：

- **メール**：support@kr777.top

---

*本利用規約の最終解釈権はAllModelsに帰属します。*

---

## Version Française

# Conditions d'Utilisation

**Dernière mise à jour : 1er janvier 2025**

**Date d'entrée en vigueur : 1er janvier 2025**

Bienvenue sur AllModels (ci-après « la Plateforme » ou « nous »). Veuillez lire attentivement et comprendre pleinement les présentes Conditions d'Utilisation (ci-après « le Contrat ») avant de vous inscrire et d'utiliser nos services.

### 1. Description du service

AllModels est une plateforme de passerelle LLM unifiée qui fournit les services suivants :

- Accès API agrégé à plus de 40 fournisseurs de modèles IA majeurs dans le monde
- Format API unifié compatible OpenAI
- Gestion des comptes utilisateurs et des clés API
- Gestion des quotas, statistiques d'utilisation et services de facturation
- Plans d'abonnement et facturation à l'utilisation

### 2. Inscription et gestion du compte

- Vous devez créer un compte pour utiliser les services principaux de la Plateforme
- Vous devez fournir des informations d'inscription véridiques et exactes
- Vous êtes responsable de la protection de vos identifiants (mots de passe, clés API, etc.) ; les pertes dues à une mauvaise gestion sont de votre responsabilité
- Chaque utilisateur ne peut créer qu'un seul compte ; l'inscription de comptes multiples pour obtenir des avantages indus est interdite
- Nous nous réservons le droit de suspendre ou de résilier les comptes en cas de violation

### 3. Règles d'utilisation

Lors de l'utilisation des services de la Plateforme, vous devez respecter les règles suivantes :

**Activités interdites :**
- Utiliser la Plateforme pour toute activité contraire aux lois et réglementations
- Générer ou diffuser du contenu illégal, nuisible, menaçant, harcelant, diffamatoire, pornographique ou autrement inapproprié
- Tenter d'accéder sans autorisation aux systèmes de la Plateforme ou aux données d'autres utilisateurs
- Procéder à l'ingénierie inverse, la décompilation ou le désassemblage de la Plateforme
- Utiliser des outils automatisés pour attaquer ou abuser des services de la Plateforme
- Revendre ou partager l'accès API sans autorisation
- Contourner les limites de débit ou les mesures de sécurité de la Plateforme

### 4. Propriété intellectuelle

- Les logiciels, le design de l'interface, les marques et logos de la Plateforme sont notre propriété intellectuelle
- La propriété intellectuelle du contenu généré via l'API est soumise aux conditions des fournisseurs de modèles IA respectifs
- Vous ne pouvez pas copier, modifier ou distribuer le contenu propriétaire de la Plateforme

### 5. Facturation et paiement

- La Plateforme propose la facturation à l'utilisation et par abonnement
- Les montants rechargés sont convertis en crédits pour payer les frais d'appels API
- Les prix des appels de modèles sont basés sur la grille tarifaire publiée sur la Plateforme ; nous nous réservons le droit d'ajuster les prix
- Les crédits rechargés ne sont pas remboursables ; pour les cas particuliers, veuillez contacter le service client
- Les crédits des plans d'abonnement sont réinitialisés à chaque cycle ; les crédits non utilisés ne sont pas reportés au cycle suivant

### 6. Protection de la vie privée

Nous accordons une grande importance à votre vie privée. Veuillez consulter notre Politique de Confidentialité pour plus de détails. L'utilisation de la Plateforme constitue votre consentement à la collecte et à l'utilisation de vos informations conformément à la Politique de Confidentialité.

### 7. Clause de non-responsabilité

- En tant que passerelle API, la Plateforme n'est pas responsable du contenu généré par les modèles IA tiers
- Nous ne garantissons pas un service ininterrompu ou sans erreur, mais nous ferons tout notre possible pour assurer la stabilité du service
- Nous ne sommes pas responsables des interruptions de service causées par des cas de force majeure
- Nous ne sommes pas responsables des impacts causés par les changements ou interruptions de service des fournisseurs de modèles IA en amont
- La Plateforme n'est pas responsable des pertes résultant de violations des règles d'utilisation par les utilisateurs

### 8. Limitation de responsabilité

Dans la mesure maximale permise par la loi, nous ne serons pas responsables des dommages indirects, accessoires, spéciaux ou consécutifs résultant de l'utilisation ou de l'impossibilité d'utiliser les services de la Plateforme. Notre responsabilité maximale ne dépassera pas le montant total que vous avez payé à la Plateforme au cours des 12 mois précédant le litige.

### 9. Résiliation du service

- Vous pouvez résilier votre compte et cesser d'utiliser les services de la Plateforme à tout moment
- Nous nous réservons le droit de suspendre ou de résilier votre compte en cas de violation du Contrat
- Après la résiliation du compte, vos données seront traitées conformément à la Politique de Confidentialité
- La résiliation du compte n'affecte pas les droits et obligations nés avant la résiliation

### 10. Droit applicable et résolution des litiges

- Le présent Contrat est régi par les lois de la République populaire de Chine
- Les litiges découlant du présent Contrat seront d'abord résolus par négociation amiable
- En cas d'échec de la négociation, chaque partie peut saisir le tribunal compétent du lieu où se trouve la Plateforme

### 11. Modifications du contrat

Nous nous réservons le droit de modifier le présent Contrat à tout moment. Le Contrat modifié sera publié sur la Plateforme, et les modifications importantes seront communiquées par des annonces sur le site web ou par e-mail. L'utilisation continue des services de la Plateforme vaut acceptation du Contrat modifié.

### 12. Nous contacter

Si vous avez des questions ou des suggestions concernant le présent Contrat, veuillez nous contacter :

- **E-mail** : support@kr777.top

---

*AllModels se réserve le droit d'interprétation finale des présentes Conditions d'Utilisation.*`;

const UserAgreement = () => {
  const { t } = useTranslation();

  return (
    <DocumentRenderer
      apiEndpoint='/api/user-agreement'
      title={t('用户协议')}
      cacheKey='user_agreement'
      emptyMessage={t('加载用户协议内容失败...')}
      defaultContent={multiLangContent}
      forceDefault
    />
  );
};

export default UserAgreement;
