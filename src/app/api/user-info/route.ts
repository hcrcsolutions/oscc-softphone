import { NextRequest, NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import jwt from 'jsonwebtoken';

export async function GET(request: NextRequest) {
  try {
    // Get headers and cookies
    const headersList = await headers();
    const cookieStore = await cookies();
    
    // Try to get token from authorization header
    const auth = headersList.get('authorization');
    const token = auth?.split(' ')[1];
    
    // Try to get token from cookies as fallback
    const idToken = cookieStore.get('IdToken')?.value;
    
    // Decode the token (without verification for now - in production you should verify)
    const tokenToUse = token || idToken;
    
    if (!tokenToUse) {
      return NextResponse.json({ 
        corpId: undefined, 
        empName: undefined 
      });
    }
    
    const decoded = jwt.decode(tokenToUse) as any;
    
    // Extract user info from the decoded token
    const corpId = decoded?.upn?.split('@')[0];
    const empName = decoded?.name;
    
    return NextResponse.json({
      corpId: corpId || undefined,
      empName: empName || undefined
    });
    
  } catch (error) {
    console.error('Failed to decode user info:', error);
    return NextResponse.json({ 
      corpId: undefined, 
      empName: undefined 
    });
  }
}