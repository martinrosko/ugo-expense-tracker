import axios from 'axios'

function getAuthHeader(): string {
  const username = import.meta.env.VITE_RESCO_USERNAME ?? ''
  const password = import.meta.env.VITE_RESCO_PASSWORD ?? ''
  return 'Basic ' + btoa(`${username}:${password}`)
}

const rescoClient = axios.create({
  baseURL: '/api',
})

rescoClient.interceptors.request.use((config) => {
  config.headers['Authorization'] = getAuthHeader()
  return config
})

export default rescoClient
