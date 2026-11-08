import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

export const config = {
  port: parseInt(process.env.PORT || '5001'),
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY || '',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    modelPlanner: 'nvidia/nemotron-3-super-120b-a12b',
    modelFast: 'nvidia/nemotron-3-nano-30b-a3b',
    maxCallsPerIncident: 20,
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromAddress: 'onboarding@resend.dev',
    demoInbox: process.env.DEMO_INBOX || '',
  },
  retell: {
    apiKey: process.env.RETELL_API_KEY || '',
    agentId: process.env.RETELL_AGENT_ID || '',
  },
};
