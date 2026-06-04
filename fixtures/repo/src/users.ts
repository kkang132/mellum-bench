import { hashPassword } from "./auth";

export interface User {
  id: string;
  name: string;
  passwordHash: string;
}

export class UserStore {
  private readonly users = new Map<string, User>();

  add(user: User): void {
    this.users.set(user.id, user);
  }

  get(id: string): User | undefined {
    return this.users.get(id);
  }
}

export function createUser(id: string, name: string, password: string, salt: string): User {
  return { id, name, passwordHash: hashPassword(password, salt) };
}

export function findUser(store: UserStore, id: string): User | undefined {
  return store.get(id);
}
