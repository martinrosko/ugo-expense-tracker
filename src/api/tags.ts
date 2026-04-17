import rescoClient from './rescoClient'
import type { Tag } from '../types/resco'

export async function fetchTags(): Promise<Tag[]> {
  const response = await rescoClient.get<{ value: Tag[] }>('/Tags')
  return response.data.value
}
