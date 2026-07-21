export interface UserRole {
  instance_id: string;
  role: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  otp_required_for_login: boolean;
  roles?: UserRole[];
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}
