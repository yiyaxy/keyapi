import React from 'react';
import { Tag } from '@douyinfe/semi-ui';

const RiskScoreBadge = ({ score }) => {
  let color = 'green';
  let label = 'Low';
  if (score >= 60) {
    color = 'red';
    label = 'High';
  } else if (score >= 30) {
    color = 'orange';
    label = 'Medium';
  }

  return (
    <Tag color={color} size='small' style={{ fontWeight: 600 }}>
      {score} ({label})
    </Tag>
  );
};

export default RiskScoreBadge;
