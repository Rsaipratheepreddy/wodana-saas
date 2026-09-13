import type { ImageSourcePropType } from 'react-native';

export type HomeModule = {
  id: 'crm' | 'pre-project' | 'projects' | 'hrms';
  label: string;
  keywords: string;
  image: ImageSourcePropType;
};

export const homeModules: readonly HomeModule[] = [
  { id: 'crm', label: 'CRM', keywords: 'customers contacts leads sales relationships', image: require('../../assets/illustrations/home/crm-v1.png') },
  { id: 'pre-project', label: 'Pre-project', keywords: 'planning designs brief quotation preproject', image: require('../../assets/illustrations/home/pre-project-v1.png') },
  { id: 'projects', label: 'Projects', keywords: 'construction delivery site building', image: require('../../assets/illustrations/home/projects-v1.png') },
  { id: 'hrms', label: 'HRMS', keywords: 'people team attendance leave employees human resources', image: require('../../assets/illustrations/home/hrms-v1.png') },
];
