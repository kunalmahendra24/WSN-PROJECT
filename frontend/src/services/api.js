import axios from 'axios';

const API = axios.create({ baseURL: '/api' });

// Attach token to every request
API.interceptors.request.use((config) => {
  const token = localStorage.getItem('wsn_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const authAPI = {
  register: (data) => API.post('/auth/register', data),
  login: (data) => API.post('/auth/login', data),
};

export const simAPI = {
  run: (config) => API.post('/simulate', config),
  save: (data) => API.post('/save', data),
  getResult: (id) => API.get(`/results/${id}`),
  history: () => API.get('/history'),
};

export default API;
