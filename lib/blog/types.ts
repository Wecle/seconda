export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  author: {
    name: string;
    role: string;
  };
  publishedAt: string; // YYYY-MM-DD
  updatedAt?: string;
  readTime: string;
  content: string;
}
