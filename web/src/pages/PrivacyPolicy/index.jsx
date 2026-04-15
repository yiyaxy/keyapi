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

---

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

*CaMeL API reserves the right of final interpretation of this Privacy Policy.*

---

## 日本語版

# プライバシーポリシー

**最終更新日：2025年1月1日**

**発効日：2025年1月1日**

CaMeL API（以下「当社」）は、お客様のプライバシー保護を非常に重視しています。本プライバシーポリシーは、当社がお客様の個人情報をどのように収集、使用、保存、保護するかについて説明するものです。サービスをご利用になる前に、本ポリシーをよくお読みください。

### 1. 情報の収集

当社は以下の種類の情報を収集する場合があります：

- **アカウント情報**：登録時に提供されるユーザー名、メールアドレス、パスワード（暗号化保存）
- **利用データ**：API呼び出し記録、モデル使用状況、リクエスト頻度およびタイムスタンプ
- **支払い情報**：チャージ記録、サブスクリプション情報（当社はお客様の銀行カードや決済口座情報を直接保存しません。決済は第三者決済サービスプロバイダーが処理します）
- **技術情報**：IPアドレス、ブラウザの種類、デバイス情報、OSバージョン
- **ログデータ**：サーバーアクセスログ、エラーログ（サービスの最適化と障害対応に使用）

### 2. 情報の使用

収集した情報は以下の目的で使用されます：

- サービスの提供、維持、改善
- お客様の取引処理とアカウント管理
- サービス通知と技術サポート情報の送信
- 利用傾向の監視と分析によるユーザー体験の最適化
- 不正行為や悪用の防止
- 法令遵守

### 3. Cookieおよび類似技術

当社はCookieおよび類似技術を以下の目的で使用します：

- ログイン状態の維持
- お客様の設定の記憶
- サービス利用状況の分析

ブラウザの設定でCookieの設定を管理できますが、Cookieを無効にすると一部の機能に影響が出る場合があります。

### 4. 情報の共有と第三者

当社はお客様の個人情報を販売しません。以下の場合に第三者と情報を共有する場合があります：

- **サービスプロバイダー**：APIリクエストを処理するため、お客様のリクエスト内容を対応するAIモデルプロバイダー（OpenAI、Anthropic、Googleなど）に転送する必要があります
- **決済処理**：決済サービスプロバイダーがお客様のチャージおよびサブスクリプション取引を処理します
- **法的要件**：法令により要求される場合、または政府機関から法的に要請された場合
- **セキュリティ保護**：当社、ユーザー、または公衆の権利、財産、安全を保護するため

### 5. データセキュリティ

当社はお客様の個人情報を保護するために合理的な技術的・管理的措置を講じています：

- データ転送にはTLS/SSL暗号化を使用
- パスワードは業界標準のアルゴリズムで暗号化保存
- 定期的なセキュリティ監査と脆弱性スキャン
- 厳格な内部データアクセス権限管理

### 6. 児童のプライバシー

当社のサービスは16歳未満の未成年者を対象としていません。当社は未成年者の個人情報を故意に収集しません。未成年者が当社に個人情報を提供したことが判明した場合は、ご連絡ください。速やかに該当情報を削除いたします。

### 7. 国際データ転送

当社はグローバルな複数のAIモデルプロバイダーを集約しているため、お客様のAPIリクエストデータは処理のために他の国や地域のサーバーに転送される場合があります。当社はこのような転送が適用されるデータ保護法に準拠することを保証します。

### 8. お客様の権利

適用法に基づき、お客様は以下の権利を有します：

- **アクセス権**：当社が保有するお客様の個人情報を閲覧する権利
- **訂正権**：不正確な個人情報を訂正する権利
- **削除権**：個人情報の削除を要求する権利
- **データポータビリティ権**：構造化された形式でデータを取得する権利
- **同意撤回権**：以前に与えた同意を撤回する権利

上記の権利を行使される場合は、以下の連絡先までご連絡ください。

### 9. データ保持

当社は本ポリシーに記載された目的を達成するために必要な期間、お客様の個人情報を保持します。不要になった場合は、安全に削除または匿名化処理します。API呼び出しログはデフォルトで90日間保持されます。

### 10. ポリシーの変更

当社は本プライバシーポリシーを随時更新する場合があります。重大な変更はウェブサイトの告知またはメールでお知らせします。サービスの継続利用は、更新されたポリシーへの同意を意味します。

### 11. お問い合わせ

本プライバシーポリシーに関するご質問やご提案がございましたら、以下の方法でお問い合わせください：

- **メール**：support@kr777.top

---

*本プライバシーポリシーの最終解釈権はCaMeL APIに帰属します。*

---

## Version Française

# Politique de Confidentialité

**Dernière mise à jour : 1er janvier 2025**

**Date d'entrée en vigueur : 1er janvier 2025**

CaMeL API (ci-après « nous ») accorde une grande importance à la protection de votre vie privée. Cette Politique de Confidentialité vise à vous expliquer comment nous collectons, utilisons, stockons et protégeons vos informations personnelles. Veuillez lire attentivement cette politique avant d'utiliser nos services.

### 1. Collecte d'informations

Nous pouvons collecter les types d'informations suivants :

- **Informations de compte** : nom d'utilisateur, adresse e-mail et mot de passe (stocké de manière chiffrée) fournis lors de l'inscription
- **Données d'utilisation** : enregistrements d'appels API, utilisation des modèles, fréquence des requêtes et horodatages
- **Informations de paiement** : historique de recharge et informations d'abonnement (nous ne stockons pas directement vos informations bancaires ; les paiements sont traités par des prestataires de services de paiement tiers)
- **Informations techniques** : adresse IP, type de navigateur, informations sur l'appareil, version du système d'exploitation
- **Données de journal** : journaux d'accès au serveur et journaux d'erreurs (utilisés pour l'optimisation du service et le dépannage)

### 2. Utilisation des informations

Les informations collectées sont utilisées aux fins suivantes :

- Fournir, maintenir et améliorer nos services
- Traiter vos transactions et gérer votre compte
- Envoyer des notifications de service et des informations de support technique
- Surveiller et analyser les tendances d'utilisation pour optimiser l'expérience utilisateur
- Prévenir la fraude et les abus
- Se conformer aux exigences légales et réglementaires

### 3. Cookies et technologies similaires

Nous utilisons des cookies et des technologies similaires pour :

- Maintenir votre session de connexion
- Mémoriser vos préférences
- Analyser l'utilisation du service

Vous pouvez gérer les préférences de cookies via les paramètres de votre navigateur, mais la désactivation des cookies peut affecter le fonctionnement normal de certaines fonctionnalités.

### 4. Partage d'informations et tiers

Nous ne vendons pas vos informations personnelles. Nous pouvons partager vos informations avec des tiers dans les circonstances suivantes :

- **Fournisseurs de services** : pour traiter les requêtes API, nous devons transmettre le contenu de vos requêtes aux fournisseurs de modèles IA correspondants (tels qu'OpenAI, Anthropic, Google, etc.)
- **Traitement des paiements** : les prestataires de services de paiement traitent vos transactions de recharge et d'abonnement
- **Exigences légales** : lorsque la loi l'exige ou sur demande des autorités gouvernementales
- **Protection de la sécurité** : pour protéger nos droits, notre propriété ou notre sécurité, ainsi que ceux des utilisateurs ou du public

### 5. Sécurité des données

Nous prenons des mesures techniques et administratives raisonnables pour protéger vos informations personnelles :

- Chiffrement TLS/SSL pour la transmission des données
- Stockage chiffré des mots de passe avec des algorithmes standard de l'industrie
- Audits de sécurité et analyses de vulnérabilités réguliers
- Contrôle strict des droits d'accès aux données internes

### 6. Vie privée des enfants

Nos services ne s'adressent pas aux mineurs de moins de 16 ans. Nous ne collectons pas intentionnellement d'informations personnelles auprès de mineurs. Si vous découvrez qu'un mineur nous a fourni des informations personnelles, veuillez nous contacter et nous supprimerons rapidement les informations concernées.

### 7. Transferts internationaux de données

Étant donné que nous agrégeons plusieurs fournisseurs de modèles IA à l'échelle mondiale, vos données de requêtes API peuvent être transférées vers des serveurs situés dans d'autres pays ou régions pour traitement. Nous veillons à ce que ces transferts soient conformes aux lois applicables en matière de protection des données.

### 8. Vos droits

Conformément à la législation applicable, vous disposez des droits suivants :

- **Droit d'accès** : consulter les informations personnelles que nous détenons à votre sujet
- **Droit de rectification** : corriger les informations personnelles inexactes
- **Droit de suppression** : demander la suppression de vos informations personnelles
- **Droit à la portabilité des données** : obtenir vos données dans un format structuré
- **Droit de retrait du consentement** : retirer un consentement précédemment donné

Pour exercer ces droits, veuillez nous contacter aux coordonnées ci-dessous.

### 9. Conservation des données

Nous conservons vos informations personnelles aussi longtemps que nécessaire pour atteindre les objectifs décrits dans cette politique. Lorsqu'elles ne sont plus nécessaires, nous les supprimons de manière sécurisée ou les anonymisons. Les journaux d'appels API sont conservés par défaut pendant 90 jours.

### 10. Modifications de la politique

Nous pouvons mettre à jour cette Politique de Confidentialité de temps à autre. Les modifications importantes seront communiquées par des annonces sur le site web ou par e-mail. L'utilisation continue de nos services vaut acceptation de la politique mise à jour.

### 11. Nous contacter

Si vous avez des questions ou des suggestions concernant cette Politique de Confidentialité, veuillez nous contacter :

- **E-mail** : support@kr777.top

---

*CaMeL API se réserve le droit d'interprétation finale de cette Politique de Confidentialité.*`;

const PrivacyPolicy = () => {
  const { t } = useTranslation();

  return (
    <DocumentRenderer
      apiEndpoint='/api/privacy-policy'
      title={t('隐私政策')}
      cacheKey='privacy_policy'
      emptyMessage={t('加载隐私政策内容失败...')}
      defaultContent={multiLangContent}
      forceDefault
    />
  );
};

export default PrivacyPolicy;
