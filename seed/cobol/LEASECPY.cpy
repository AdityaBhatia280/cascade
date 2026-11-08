      ******************************************************************
      * LEASECPY.CPY - LEASE MASTER RECORD LAYOUT
      * SHARED COPYBOOK FOR LEASE BILLING SUBSYSTEM
      * USED BY: LEASEBIL, CAMCALC
      * LAST MODIFIED: 2018-09-14 BY D.KOWALSKI
      * CHANGE LOG:
      *   2018-09-14 - ADDED CREDIT FIELDS FOR SLA PROCESSING
      *   2017-03-22 - ADDED CAM CAP FIELDS
      *   2016-11-01 - INITIAL CREATION
      ******************************************************************

       01  LEASE-MASTER-RECORD.
           05  LM-TENANT-ID            PIC X(10).
           05  LM-TENANT-NAME          PIC X(40).
           05  LM-UNIT-ID              PIC X(8).
           05  LM-LEASE-NUM            PIC X(12).
           05  LM-LEASE-STATUS         PIC X(1).
               88  LM-ACTIVE           VALUE 'A'.
               88  LM-EXPIRED          VALUE 'E'.
               88  LM-PENDING          VALUE 'P'.
           05  LM-LEASE-TYPE           PIC X(2).
               88  LM-GROSS            VALUE 'GR'.
               88  LM-NET              VALUE 'NT'.
               88  LM-MODIFIED-GROSS   VALUE 'MG'.

           05  LM-DATE-BLOCK.
               10  LM-COMMENCE-DATE    PIC 9(8).
               10  LM-EXPIRE-DATE      PIC 9(8).
               10  LM-AMEND-DATE       PIC 9(8).

           05  LM-AREA-BLOCK.
               10  LM-TENANT-AREA-SF   PIC 9(7)V99  COMP-3.
               10  LM-BLDG-TOTAL-SF    PIC 9(7)V99  COMP-3.
               10  LM-OCCUPIED-SF      PIC 9(7)V99  COMP-3.

           05  LM-RENT-BLOCK.
               10  LM-BASE-RENT-MO     PIC 9(7)V99  COMP-3.
               10  LM-RENT-ESCALATION  PIC 9(3)V99  COMP-3.
               10  LM-RENT-START-DATE  PIC 9(8).
               10  LM-RENT-PSF         PIC 9(5)V99  COMP-3.

           05  LM-CAM-BLOCK.
               10  LM-BASE-YEAR        PIC 9(4).
               10  LM-BASE-EXPENSE-SF  PIC 9(5)V99  COMP-3.
               10  LM-CURR-EXPENSE-SF  PIC 9(5)V99  COMP-3.
               10  LM-CAM-CAP-TYPE     PIC X(2).
                   88  LM-CAP-CUMUL    VALUE 'CU'.
                   88  LM-CAP-NONCUMUL VALUE 'NC'.
                   88  LM-CAP-NONE     VALUE '  '.
               10  LM-CAM-CAP-PCT      PIC 9(3)V99  COMP-3.
               10  LM-PRO-RATA-METHOD  PIC X(1).
                   88  LM-PRORATE-TOTAL VALUE 'T'.
                   88  LM-PRORATE-OCCUP VALUE 'O'.
               10  LM-SHARE-PCT        PIC 9(3)V9(4) COMP-3.

           05  LM-CREDIT-BLOCK.
               10  LM-SLA-TIER         PIC 9(1).
               10  LM-SLA-CREDIT-AMT   PIC 9(7)V99  COMP-3.
               10  LM-MONTHLY-FEE      PIC 9(7)V99  COMP-3.
               10  LM-COOL-STATUS      PIC X(1).
                   88  LM-COOL-OK      VALUE 'Y'.
                   88  LM-COOL-FAIL    VALUE 'N'.

           05  LM-BILLING-BLOCK.
               10  LM-INVOICE-AMT      PIC 9(9)V99  COMP-3.
               10  LM-CAM-CHARGE-MO    PIC 9(7)V99  COMP-3.
               10  LM-TOTAL-BILLING    PIC 9(9)V99  COMP-3.
               10  LM-LAST-BILL-DATE   PIC 9(8).

           05  LM-AUDIT-BLOCK.
               10  LM-CREATED-BY       PIC X(8).
               10  LM-CREATED-DATE     PIC 9(8).
               10  LM-MODIFIED-BY      PIC X(8).
               10  LM-MODIFIED-DATE    PIC 9(8).

      ******************************************************************
      * REDEFINES FOR FLAT FILE EXPORT (FIXED-LENGTH 400 BYTES)
      ******************************************************************
           05  LM-FLAT-RECORD REDEFINES LM-AUDIT-BLOCK.
               10  LM-FLAT-USER        PIC X(8).
               10  LM-FLAT-TIMESTAMP   PIC X(8).

      ******************************************************************
      * NOTE: HVAC-LINK SUBSYSTEM FIELDS RESERVED FOR FUTURE USE
      * SEE HVAC-LINK INTERFACE SPEC DOC REF HVL-2017-003
      ******************************************************************
           05  LM-RESERVED-BLOCK.
               10  LM-HVAC-LINK-FLAG   PIC X(1).
               10  LM-FILLER-01        PIC X(19).
