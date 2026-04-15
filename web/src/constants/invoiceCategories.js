/**
 * Predefined invoice goods categories for user/admin selection.
 *
 * Each entry maps to PiaoTong's BlueInvoiceItem fields:
 *   - code  → taxClassificationCode
 *   - name  → goodsName (format: *简称*商品名称)
 *
 * Tax rate is intentionally NOT bundled here — it is managed separately by admins.
 * Source: 税收分类编码表(20250714版).xlsx, filtered for IT/tech service relevance.
 */
const INVOICE_GOODS_CATEGORIES = [
  { key: 'it_other_software', code: '3040201990000000000', name: '*信息技术服务*其他软件服务', defaultTaxRate: '0.01' },
  { key: 'software_database_product', code: '1060301010200000000', name: '*软件*数据库软件产品', defaultTaxRate: '0.01' },
  { key: 'it_system_service', code: '3040203000000000000', name: '*信息技术服务*信息系统服务', defaultTaxRate: '0.01' },
];

export default INVOICE_GOODS_CATEGORIES;

/**
 * Format a category for display in a Select option.
 */
export function formatCategoryLabel(cat, t) {
  if (!cat) return '';
  if (typeof t === 'function' && cat.key) {
    return t(`invoice.category.${cat.key}`);
  }
  return String(cat.name || '').replace(/^\*[^*]*\*/, '').trim() || cat.name;
}

/**
 * Find a category by its code from the predefined list.
 */
export function findCategoryByCode(code) {
  return INVOICE_GOODS_CATEGORIES.find((c) => c.code === code) || null;
}
