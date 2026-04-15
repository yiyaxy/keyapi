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
import { Globe, Coins, Eye, Key, CreditCard, CalendarClock, BarChart3, UserPlus, Wallet, Code2 } from 'lucide-react';

const About = () => {
  const { t } = useTranslation();
  const features = [
    {
      icon: <Globe size={28} className='text-indigo-500' />,
      title: t('无国界连接'),
      description: t('aboutAdvantageGlobal'),
    },
    {
      icon: <Coins size={28} className='text-amber-500' />,
      title: t('极致性价比'),
      description: t('aboutAdvantageCost'),
    },
    {
      icon: <Eye size={28} className='text-teal-500' />,
      title: t('透明可控'),
      description: t('aboutAdvantageTransparent'),
    },
  ];

  return (
    <div className='mt-16 min-h-[calc(100vh-64px)] flex flex-col'>
      {/* Hero Section */}
      <div className='relative overflow-hidden'>
        <div className='hero-mesh' />
        <div className='max-w-4xl mx-auto px-6 py-16 text-center'>
          <h1 className='text-3xl md:text-4xl lg:text-5xl font-bold mb-6'>
            <span className='gradient-text'>{t('aboutHeroTitle')}</span>
          </h1>
          <p className='text-lg md:text-xl text-semi-color-text-2 max-w-2xl mx-auto leading-relaxed'>
            {t('aboutDescription')}
          </p>
        </div>
      </div>

      {/* Features Section */}
      <div className='flex-1 max-w-5xl mx-auto px-6 py-12 w-full'>
        <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
          {features.map((feature, index) => (
            <div
              key={index}
              className='glass-card p-6 flex flex-col items-center text-center'
            >
              <div className='w-14 h-14 rounded-full bg-semi-color-fill-0 flex items-center justify-center mb-4'>
                {feature.icon}
              </div>
              <h3 className='text-lg font-semibold text-semi-color-text-0 mb-3'>
                {feature.title}
              </h3>
              <p className='text-sm text-semi-color-text-2 leading-relaxed'>
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        {/* Services Section */}
        <div className='mt-12'>
          <h2 className='text-xl font-semibold text-semi-color-text-0 text-center mb-6'>{t('aboutServiceTitle')}</h2>
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
            {[
              { icon: <Key size={22} className='text-blue-500' />, text: t('aboutService1') },
              { icon: <CreditCard size={22} className='text-green-500' />, text: t('aboutService2') },
              { icon: <CalendarClock size={22} className='text-purple-500' />, text: t('aboutService3') },
              { icon: <BarChart3 size={22} className='text-orange-500' />, text: t('aboutService4') },
            ].map((item, i) => (
              <div key={i} className='glass-card p-4 flex items-center gap-3'>
                <div className='w-10 h-10 rounded-lg bg-semi-color-fill-0 flex items-center justify-center shrink-0'>
                  {item.icon}
                </div>
                <p className='text-sm text-semi-color-text-1'>{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Steps Section */}
        <div className='mt-12'>
          <h2 className='text-xl font-semibold text-semi-color-text-0 text-center mb-6'>{t('aboutStepsTitle')}</h2>
          <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
            {[
              { icon: <UserPlus size={24} className='text-blue-500' />, title: t('aboutStep1Title'), desc: t('aboutStep1Desc') },
              { icon: <Wallet size={24} className='text-green-500' />, title: t('aboutStep2Title'), desc: t('aboutStep2Desc') },
              { icon: <Code2 size={24} className='text-purple-500' />, title: t('aboutStep3Title'), desc: t('aboutStep3Desc') },
            ].map((step, i) => (
              <div key={i} className='glass-card p-5 text-center'>
                <div className='w-12 h-12 rounded-full bg-semi-color-fill-0 flex items-center justify-center mx-auto mb-3'>
                  {step.icon}
                </div>
                <h3 className='text-base font-semibold text-semi-color-text-0 mb-2'>{step.title}</h3>
                <p className='text-sm text-semi-color-text-2'>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Slogan */}
        <div className='text-center mt-12'>
          <p className='text-base text-semi-color-text-1 font-medium'>
            {t('aboutSlogan')}
          </p>
        </div>
      </div>

    </div>
  );
};

export default About;
