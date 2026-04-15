// Re-export all API types for convenient imports
export * from './api';

// Additional frontend-specific types can be added here
export interface TableColumn {
  title: string;
  dataIndex: string;
  key: string;
  render?: (text: any, record: any, index: number) => React.ReactNode;
  sorter?: boolean | ((a: any, b: any) => number);
  filters?: Array<{ text: string; value: any }>;
  onFilter?: (value: any, record: any) => boolean;
  width?: number | string;
  fixed?: 'left' | 'right';
  align?: 'left' | 'center' | 'right';
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea' | 'switch' | 'date' | 'password';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: any }>;
  rules?: any[];
  disabled?: boolean;
  defaultValue?: any;
}

export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  path?: string;
  children?: MenuItem[];
  visible?: boolean;
}

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

export interface ChartData {
  name: string;
  value: number;
  [key: string]: any;
}

export interface FilterOption {
  label: string;
  value: string | number;
}

export interface ActionButton {
  label: string;
  onClick: () => void;
  type?: 'primary' | 'secondary' | 'tertiary' | 'warning' | 'danger';
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
}
