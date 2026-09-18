import type { User } from "@supabase/supabase-js";

const ADMIN_USERS_PAGE_SIZE = 100;

export async function listAllAuthUsers(
  supabase: {
    auth: {
      admin: {
        listUsers: (params: {
          page: number;
          perPage: number;
        }) => Promise<{ data: { users?: User[] | null } | null; error: { message: string } | null }>;
      };
    };
  },
) {
  const users: User[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: ADMIN_USERS_PAGE_SIZE,
    });

    if (error) {
      return { data: null, error };
    }

    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);

    if (pageUsers.length < ADMIN_USERS_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  return {
    data: { users },
    error: null,
  };
}
