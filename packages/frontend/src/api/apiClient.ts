import axios from 'axios'
import keycloak from '../auth/keycloak'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
})

apiClient.interceptors.request.use(async (config) => {
  // Refresh token if it expires in less than 30 seconds
  if (keycloak.isTokenExpired(30)) {
    await keycloak.updateToken(30)
  }
  if (keycloak.token) {
    config.headers['Authorization'] = `Bearer ${keycloak.token}`
  }
  return config
})

export default apiClient
