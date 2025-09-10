'use client';

import React, { useEffect, useState } from 'react';
import { TbUser } from 'react-icons/tb';

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
      <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar flex items-center justify-center">
        <div className="w-full h-full rounded-full flex items-center justify-center bg-base-200">
          <TbUser className="w-8 h-8" style={{ transform: 'translate(3px, 3px)' }} />
        </div>
      </div>
      <ul tabIndex={0} className="menu menu-sm dropdown-content bg-base-100 rounded-box z-[1] mt-3 min-w-max p-2 shadow">
        <li>
          <a className="block whitespace-nowrap">
            {userInfo.empName || 'Welcome User'}
          </a>
        </li>
      </ul>
    </div>
  );
}