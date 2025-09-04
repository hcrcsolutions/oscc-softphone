'use client';

import React, { useEffect, useState } from 'react';

interface UserInfo {
  corpId?: string;
  empName?: string;
}

export default function Avatar() {
  const [userInfo, setUserInfo] = useState<UserInfo>({});

  useEffect(() => {
    // Fetch user info from API route
    fetch('/api/user-info')
      .then(res => res.json())
      .then(data => {
        setUserInfo(data);
      })
      .catch(err => {
        console.error('Failed to fetch user info:', err);
        setUserInfo({
          corpId: undefined,
          empName: undefined
        });
      });
  }, []);

  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar">
        <div className="w-10 rounded-full">
          {userInfo.corpId ? (
            <img
              alt="Avatar"
              src={`https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp`}
            />
          ) : (
            <img 
              alt="Avatar" 
              src="https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp" 
            />
          )}
        </div>
      </div>
      <ul tabIndex={0} className="menu menu-sm dropdown-content bg-base-100 rounded-box z-[1] mt-3 w-52 p-2 shadow">
        <li>
          <a className="justify-between whitespace-nowrap">
            {userInfo.empName || 'Welcome User'}
          </a>
        </li>
      </ul>
    </div>
  );
}