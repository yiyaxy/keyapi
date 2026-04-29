import { Home, Grid, Users, User, ArrowRight, Zap, Key, ExternalLink, ChevronRight, Share2, Wallet, History, MessageSquare, ShieldCheck, Download, Award, TrendingUp } from 'lucide-react';

export type TabType = 'home' | 'apps' | 'invite' | 'profile';

export interface AIAppCard {
  id: string;
  title: string;
  description: string;
  image: string;
  tokenCost: string;
  icon: any;
}

export const AI_APPS: AIAppCard[] = [
  {
    id: 'diagnose',
    title: '形象诊断',
    description: '多维度分析气质与着装建议',
    image: 'https://images.unsplash.com/photo-1539109132381-315555a527c4?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    tokenCost: '50K / 次',
    icon: Zap
  },
  {
    id: 'hair',
    title: '发型设计',
    description: '基于脸型的AI虚拟发型预览',
    image: 'https://images.unsplash.com/photo-1560869713-7d0a29430863?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    tokenCost: '80K / 次',
    icon: TrendingUp
  },
  {
    id: 'face',
    title: '面相手相',
    description: '传统玄学与大模型图像识别',
    image: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    tokenCost: '120K / 次',
    icon: ShieldCheck
  },
  {
    id: 'xhs',
    title: '小红书文案',
    description: '爆款模版，快速生成种草笔记',
    image: 'https://images.unsplash.com/photo-1542435503-956c469947f6?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
    tokenCost: '15K / 篇',
    icon: MessageSquare
  }
];
